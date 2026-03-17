import type {
    AppAlbum,
    AppAlbumPhoto,
    AppArticle,
    AppDiary,
    AppDiaryImage,
    AppProfile,
    SidebarProfileData,
} from "@/types/app";
import type { JsonObject } from "@/types/json";
import type {
    BangumiCollectionItem,
    BangumiCollectionStatus,
    BangumiListResult,
} from "@/server/bangumi/types";
import { cacheManager } from "@/server/cache/manager";
import { loadBangumiCollections } from "@/server/bangumi/service";
import { decryptBangumiAccessToken } from "@/server/bangumi/token";
import { normalizeBangumiId } from "@/server/bangumi/username";
import { countItems, readMany } from "@/server/directus/client";
import { buildPublicAssetUrl } from "@/server/directus-auth";
import { isShortId } from "@/server/utils/short-id";

import type { AuthorBundleItem } from "./shared/author-cache";
import { getAuthorBundle } from "./shared/author-cache";
import {
    DIARY_FIELDS,
    DEFAULT_LIST_LIMIT,
    excludeSpecialArticleSlugFilter,
    filterPublicStatus,
    loadPublicAlbumByShortId,
    loadPublicDiaryByShortId,
    safeCsv,
} from "./shared";

// ---------------------------------------------------------------------------
// ContentLoadResult：区分「资源不存在」与「无权限访问」
// ---------------------------------------------------------------------------

export type ContentLoadResult<T> =
    | { status: "ok"; data: T }
    | { status: "not_found" }
    | { status: "permission_denied"; reason: string };

// ---------------------------------------------------------------------------
// ViewerOptions：传入当前访问者，用于 owner 隐私绕过判定
// ---------------------------------------------------------------------------

export type ViewerOptions = { viewerId?: string | null };

type PublicProfile = Omit<AppProfile, "bangumi_access_token_encrypted">;

/** 文章过滤：非 owner 仅按公开状态过滤（文章不再有 show_on_profile） */
function articleFilters(isOwner: boolean): JsonObject[] {
    return isOwner
        ? [excludeSpecialArticleSlugFilter()]
        : [filterPublicStatus(), excludeSpecialArticleSlugFilter()];
}

/** 日记过滤：非 owner 仅按发布且非私有过滤 */
function diaryFilters(isOwner: boolean): JsonObject[] {
    return isOwner
        ? []
        : [{ status: { _eq: "published" } }, { praviate: { _eq: true } }];
}

/** 相册过滤：非 owner 仅按公开条件过滤，不再依赖 show_on_profile */
function albumFilters(isOwner: boolean): JsonObject[] {
    return isOwner ? [] : [filterPublicStatus()];
}

// ---------------------------------------------------------------------------
// 内部工具：按用户名读取资料，不附带 profile_public 限制
// ---------------------------------------------------------------------------

async function loadProfileByUsername(
    username: string,
): Promise<AppProfile | null> {
    const rows = await readMany("app_user_profiles", {
        filter: { username: { _eq: username } } as JsonObject,
        limit: 1,
    });
    return (rows[0] as AppProfile | undefined) ?? null;
}

function toAuthorFallback(userId: string): AuthorBundleItem {
    const normalized = String(userId || "").trim();
    const shortId = (normalized || "user").slice(0, 8);
    return {
        id: normalized,
        name: `user-${shortId}`,
        username: `user-${shortId}`,
    };
}

export function readAuthor(
    authorMap: Map<string, AuthorBundleItem>,
    userId: string,
): AuthorBundleItem {
    return authorMap.get(userId) || toAuthorFallback(userId);
}

export async function loadPublicProfileByUsername(
    username: string,
): Promise<AppProfile | null> {
    const rows = await readMany("app_user_profiles", {
        filter: {
            _and: [
                { username: { _eq: username } },
                { profile_public: { _eq: true } },
            ],
        } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

/**
 * 按指定访问者加载用户资料。
 * owner 始终可见；非 owner 仅在 profile_public=true 时可见。
 */
export async function loadProfileForViewer(
    username: string,
    viewerId?: string | null,
): Promise<AppProfile | null> {
    const profile = await loadProfileByUsername(username);
    if (!profile) {
        return null;
    }
    const isOwner = Boolean(viewerId) && viewerId === profile.user_id;
    if (isOwner || profile.profile_public) {
        return profile;
    }
    return null;
}

export type UserHomeData = {
    profile: PublicProfile;
    owner: {
        id: string;
        name: string;
        username?: string;
        avatar_url?: string;
        header_url?: string;
    };
    articles: Array<AppArticle & { tags: string[] }>;
    diaries: AppDiary[];
    bangumi: BangumiCollectionItem[];
    albums: Array<AppAlbum & { tags: string[] }>;
};

function toPublicProfile(profile: AppProfile): PublicProfile {
    const { bangumi_access_token_encrypted: _token, ...rest } = profile;
    return rest;
}

async function loadBangumiListForProfile(
    profile: AppProfile,
    options?: {
        limit?: number;
        page?: number;
        status?: BangumiCollectionStatus;
    },
): Promise<BangumiListResult> {
    const bangumiId = normalizeBangumiId(profile.bangumi_username);
    if (!bangumiId) {
        return {
            items: [],
            page: options?.page ?? 1,
            limit: options?.limit ?? 20,
            total: 0,
        };
    }

    return await loadBangumiCollections({
        username: bangumiId,
        page: options?.page ?? 1,
        limit: options?.limit ?? 20,
        status: options?.status,
        includePrivate: Boolean(profile.bangumi_include_private),
        accessToken: decryptBangumiAccessToken(
            profile.bangumi_access_token_encrypted,
        ),
    });
}

export async function loadUserHomeData(
    username: string,
    options?: ViewerOptions,
): Promise<ContentLoadResult<UserHomeData>> {
    const profile = await loadProfileByUsername(username);
    if (!profile) {
        return { status: "not_found" };
    }
    const isOwnerViewing =
        Boolean(options?.viewerId) && options?.viewerId === profile.user_id;
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }

    const targetUserId = profile.user_id;
    const [authorMap, articles, diaries, bangumi, albums] = await Promise.all([
        getAuthorBundle([targetUserId]),
        isOwnerViewing || profile.show_articles_on_profile
            ? readMany("app_articles", {
                  filter: {
                      _and: [
                          { author_id: { _eq: targetUserId } },
                          ...articleFilters(isOwnerViewing),
                      ],
                  } as JsonObject,
                  sort: ["-published_at", "-date_created"],
                  limit: 5,
              })
            : Promise.resolve([] as AppArticle[]),
        isOwnerViewing || profile.show_diaries_on_profile
            ? readMany("app_diaries", {
                  filter: {
                      _and: [
                          { author_id: { _eq: targetUserId } },
                          ...diaryFilters(isOwnerViewing),
                      ],
                  } as JsonObject,
                  fields: [...DIARY_FIELDS],
                  sort: ["-date_created"],
                  limit: 5,
              })
            : Promise.resolve([] as AppDiary[]),
        isOwnerViewing || profile.show_bangumi_on_profile
            ? loadBangumiListForProfile(profile, { limit: 20 }).then(
                  (result) => result.items,
              )
            : Promise.resolve([] as BangumiCollectionItem[]),
        isOwnerViewing || profile.show_albums_on_profile
            ? readMany("app_albums", {
                  filter: {
                      _and: [
                          { author_id: { _eq: targetUserId } },
                          ...albumFilters(isOwnerViewing),
                      ],
                  } as JsonObject,
                  sort: ["-date", "-date_created"],
                  limit: 5,
              })
            : Promise.resolve([] as AppAlbum[]),
    ]);

    const owner = readAuthor(authorMap, targetUserId);
    const ownerData = {
        id: targetUserId,
        name: profile.display_name || profile.username || owner.name || "user",
        username: profile.username || owner.username,
        avatar_url:
            profile.avatar_url ||
            (profile.avatar_file
                ? buildPublicAssetUrl(profile.avatar_file, {
                      width: 128,
                      height: 128,
                      fit: "cover",
                  })
                : owner.avatar_url),
        header_url: profile.header_file
            ? buildPublicAssetUrl(profile.header_file, {
                  width: 1200,
                  height: 400,
                  fit: "cover",
              })
            : undefined,
    };

    return {
        status: "ok",
        data: {
            profile: toPublicProfile(profile),
            owner: ownerData,
            articles: articles.map((item) => ({
                ...item,
                tags: safeCsv(item.tags),
            })),
            diaries,
            bangumi,
            albums: albums.map((item) => ({
                ...item,
                tags: safeCsv(item.tags),
            })),
        },
    };
}

export type PaginatedResult<T> = {
    items: T[];
    page: number;
    limit: number;
    total: number;
};

export type UserBangumiListOptions = {
    page?: number;
    limit?: number;
    status?: BangumiCollectionStatus;
};

export async function loadUserBangumiList(
    username: string,
    options: UserBangumiListOptions & ViewerOptions = {},
): Promise<
    ContentLoadResult<
        PaginatedResult<BangumiCollectionItem & { author: AuthorBundleItem }>
    >
> {
    const profile = await loadProfileByUsername(username);
    if (!profile) {
        return { status: "not_found" };
    }
    const isOwnerViewing =
        Boolean(options.viewerId) && options.viewerId === profile.user_id;
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }
    if (!isOwnerViewing && !profile.show_bangumi_on_profile) {
        return { status: "permission_denied", reason: "bangumi_not_public" };
    }

    const page =
        options.page && options.page > 0 ? Math.floor(options.page) : 1;
    const limit =
        options.limit && options.limit > 0
            ? Math.min(200, Math.floor(options.limit))
            : 20;
    const [result, authorMap] = await Promise.all([
        loadBangumiListForProfile(profile, {
            page,
            limit,
            status: options.status,
        }),
        getAuthorBundle([profile.user_id]),
    ]);
    const author = readAuthor(authorMap, profile.user_id);
    const items = result.items.map((item) => ({
        ...item,
        author,
    }));

    return { status: "ok", data: { items, page, limit, total: result.total } };
}

async function fetchDiaryCommentCountMap(
    diaryIds: string[],
): Promise<Map<string, number>> {
    if (diaryIds.length === 0) {
        return new Map();
    }
    const map = new Map<string, number>();
    await Promise.all(
        diaryIds.map(async (diaryId) => {
            try {
                const count = await countItems("app_diary_comments", {
                    _and: [
                        { diary_id: { _eq: diaryId } },
                        { status: { _eq: "published" } },
                        { is_public: { _eq: true } },
                    ],
                } as JsonObject);
                map.set(diaryId, count);
            } catch (error) {
                console.warn(
                    `[public-data] failed to load diary comment count: ${diaryId}`,
                    error,
                );
                map.set(diaryId, 0);
            }
        }),
    );
    return map;
}

async function fetchDiaryLikeCountMap(
    diaryIds: string[],
): Promise<Map<string, number>> {
    if (diaryIds.length === 0) {
        return new Map();
    }
    const map = new Map<string, number>();
    await Promise.all(
        diaryIds.map(async (diaryId) => {
            try {
                const count = await countItems("app_diary_likes", {
                    _and: [
                        { diary_id: { _eq: diaryId } },
                        { status: { _eq: "published" } },
                    ],
                } as JsonObject);
                map.set(diaryId, count);
            } catch (error) {
                console.warn(
                    `[public-data] failed to load diary like count: ${diaryId}`,
                    error,
                );
                map.set(diaryId, 0);
            }
        }),
    );
    return map;
}

export type UserDiaryListOptions = {
    page?: number;
    limit?: number;
};

export async function loadUserDiaryList(
    username: string,
    options: UserDiaryListOptions & ViewerOptions = {},
): Promise<
    ContentLoadResult<
        PaginatedResult<
            AppDiary & {
                author: AuthorBundleItem;
                images: AppDiaryImage[];
                comment_count: number;
                like_count: number;
            }
        >
    >
> {
    const profile = await loadProfileByUsername(username);
    if (!profile) {
        return { status: "not_found" };
    }
    const isOwnerViewing =
        Boolean(options.viewerId) && options.viewerId === profile.user_id;
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }
    if (!isOwnerViewing && !profile.show_diaries_on_profile) {
        return { status: "permission_denied", reason: "diaries_not_public" };
    }
    const userId = profile.user_id;

    const page =
        options.page && options.page > 0 ? Math.floor(options.page) : 1;
    const limit =
        options.limit && options.limit > 0
            ? Math.min(100, Math.floor(options.limit))
            : 20;
    const offset = (page - 1) * limit;

    const diaryFilter = {
        _and: [...diaryFilters(isOwnerViewing), { author_id: { _eq: userId } }],
    } as JsonObject;

    const [rows, total] = await Promise.all([
        readMany("app_diaries", {
            filter: diaryFilter,
            fields: [...DIARY_FIELDS],
            sort: ["-date_created"],
            limit,
            offset,
        }),
        countItems("app_diaries", diaryFilter),
    ]);

    const diaryIds = rows.map((row) => row.id);
    const diaryImageFilters: JsonObject[] = [{ diary_id: { _in: diaryIds } }];
    if (!isOwnerViewing) {
        diaryImageFilters.push(
            { status: { _eq: "published" } },
            { is_public: { _eq: true } },
        );
    }
    const [images, authorMap, commentCountMap, likeCountMap] =
        await Promise.all([
            readMany("app_diary_images", {
                filter:
                    diaryIds.length > 0
                        ? ({ _and: diaryImageFilters } as JsonObject)
                        : ({ id: { _null: true } } as JsonObject),
                sort: ["sort", "-date_created"],
                limit: Math.max(diaryIds.length * 6, DEFAULT_LIST_LIMIT),
            }),
            getAuthorBundle([userId]),
            fetchDiaryCommentCountMap(diaryIds),
            fetchDiaryLikeCountMap(diaryIds),
        ]);

    const imageMap = new Map<string, AppDiaryImage[]>();
    for (const image of images) {
        const list = imageMap.get(image.diary_id) || [];
        list.push(image);
        imageMap.set(image.diary_id, list);
    }

    const items = rows.map((row) => ({
        ...row,
        author: readAuthor(authorMap, row.author_id),
        images: imageMap.get(row.id) || [],
        comment_count: commentCountMap.get(row.id) || 0,
        like_count: likeCountMap.get(row.id) || 0,
    }));

    return { status: "ok", data: { items, page, limit, total } };
}

export type DiaryDetail = AppDiary & {
    author: AuthorBundleItem;
    images: AppDiaryImage[];
};

export async function loadUserDiaryDetail(
    username: string,
    diaryId: string,
    options?: ViewerOptions,
): Promise<ContentLoadResult<DiaryDetail>> {
    const profile = await loadProfileByUsername(username);
    if (!profile) {
        return { status: "not_found" };
    }
    const isOwnerViewing =
        Boolean(options?.viewerId) && options?.viewerId === profile.user_id;
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }
    if (!isOwnerViewing && !profile.show_diaries_on_profile) {
        return { status: "permission_denied", reason: "diaries_not_public" };
    }
    const userId = profile.user_id;

    if (!isShortId(diaryId)) {
        return { status: "not_found" };
    }

    let diary: AppDiary | null;
    if (isOwnerViewing) {
        // owner 视角：读取时不附带 status/is_public 过滤
        const rows = await readMany("app_diaries", {
            filter: { short_id: { _eq: diaryId } } as JsonObject,
            fields: [...DIARY_FIELDS],
            limit: 1,
        });
        diary = (rows[0] as AppDiary | undefined) ?? null;
    } else {
        diary = await loadPublicDiaryByShortId(diaryId);
    }
    if (!diary || diary.author_id !== userId) {
        return { status: "not_found" };
    }
    const diaryImageFilters: JsonObject[] = [{ diary_id: { _eq: diary.id } }];
    if (!isOwnerViewing) {
        diaryImageFilters.push(
            { status: { _eq: "published" } },
            { is_public: { _eq: true } },
        );
    }
    const [images, authorMap] = await Promise.all([
        readMany("app_diary_images", {
            filter: { _and: diaryImageFilters } as JsonObject,
            sort: ["sort", "-date_created"],
            limit: 100,
        }),
        getAuthorBundle([userId]),
    ]);

    return {
        status: "ok",
        data: {
            ...diary,
            author: readAuthor(authorMap, diary.author_id),
            images,
        },
    };
}

export type UserAlbumListOptions = {
    page?: number;
    limit?: number;
};

export async function loadUserAlbumList(
    username: string,
    options: UserAlbumListOptions & ViewerOptions = {},
): Promise<
    ContentLoadResult<
        PaginatedResult<AppAlbum & { tags: string[]; author: AuthorBundleItem }>
    >
> {
    const profile = await loadProfileByUsername(username);
    if (!profile) {
        return { status: "not_found" };
    }
    const isOwnerViewing =
        Boolean(options.viewerId) && options.viewerId === profile.user_id;
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }
    if (!isOwnerViewing && !profile.show_albums_on_profile) {
        return { status: "permission_denied", reason: "albums_not_public" };
    }
    const userId = profile.user_id;

    const page =
        options.page && options.page > 0 ? Math.floor(options.page) : 1;
    const limit =
        options.limit && options.limit > 0
            ? Math.min(100, Math.floor(options.limit))
            : 20;
    const offset = (page - 1) * limit;

    const albumFilter = {
        _and: [...albumFilters(isOwnerViewing), { author_id: { _eq: userId } }],
    } as JsonObject;

    const [rows, total, authorMap] = await Promise.all([
        readMany("app_albums", {
            filter: albumFilter,
            sort: ["-date", "-date_created"],
            limit,
            offset,
        }),
        countItems("app_albums", albumFilter),
        getAuthorBundle([userId]),
    ]);

    const items = rows.map((row) => ({
        ...row,
        tags: safeCsv(row.tags),
        author: readAuthor(authorMap, row.author_id),
    }));

    return { status: "ok", data: { items, page, limit, total } };
}

export type AlbumDetail = AppAlbum & {
    tags: string[];
    author: AuthorBundleItem;
    photos: Array<AppAlbumPhoto & { tags: string[] }>;
};

export async function loadUserAlbumDetail(
    username: string,
    albumId: string,
    options?: ViewerOptions,
): Promise<ContentLoadResult<AlbumDetail>> {
    const profile = await loadProfileByUsername(username);
    if (!profile) {
        return { status: "not_found" };
    }
    const isOwnerViewing =
        Boolean(options?.viewerId) && options?.viewerId === profile.user_id;
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }
    if (!isOwnerViewing && !profile.show_albums_on_profile) {
        return { status: "permission_denied", reason: "albums_not_public" };
    }
    const userId = profile.user_id;

    if (!isShortId(albumId)) {
        return { status: "not_found" };
    }

    let album: AppAlbum | null;
    if (isOwnerViewing) {
        // owner 视角：读取时不附带 status/is_public 过滤
        const rows = await readMany("app_albums", {
            filter: { short_id: { _eq: albumId } } as JsonObject,
            limit: 1,
        });
        album = (rows[0] as AppAlbum | undefined) ?? null;
    } else {
        album = await loadPublicAlbumByShortId(albumId);
    }
    if (!album || album.author_id !== userId) {
        return { status: "not_found" };
    }
    const photoFilters: JsonObject[] = [{ album_id: { _eq: album.id } }];
    if (!isOwnerViewing) {
        photoFilters.push(
            { status: { _eq: "published" } },
            { is_public: { _eq: true } },
        );
    }
    const [photos, authorMap] = await Promise.all([
        readMany("app_album_photos", {
            filter: { _and: photoFilters } as JsonObject,
            sort: ["sort", "-date_created"],
            limit: 200,
        }) as Promise<AppAlbumPhoto[]>,
        getAuthorBundle([userId]),
    ]);

    return {
        status: "ok",
        data: {
            ...album,
            tags: safeCsv(album.tags),
            author: readAuthor(authorMap, album.author_id),
            photos: photos.map((photo) => ({
                ...photo,
                tags: safeCsv(photo.tags),
            })),
        },
    };
}

export function profileToSidebarData(profile: AppProfile): SidebarProfileData {
    const avatarUrl = profile.avatar_file
        ? buildPublicAssetUrl(profile.avatar_file)
        : profile.avatar_url || null;

    return {
        display_name: profile.display_name || profile.username || "user",
        bio: profile.bio ?? null,
        bio_typewriter_enable: profile.bio_typewriter_enable ?? true,
        bio_typewriter_speed: Math.max(
            10,
            Math.min(
                500,
                Math.floor(Number(profile.bio_typewriter_speed) || 80),
            ),
        ),
        avatar_url: avatarUrl,
        username: profile.username || null,
        social_links: profile.social_links ?? null,
        is_official: profile.is_official ?? false,
    };
}

export async function loadPublicProfileByUserId(
    userId: string,
): Promise<AppProfile | null> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
        return null;
    }
    const cacheKey = `public:${normalizedUserId}`;
    const cached = await cacheManager.get<{
        exists: boolean;
        profile: AppProfile | null;
    }>("profile-viewer", cacheKey);
    if (cached) {
        return cached.profile;
    }

    const rows = await readMany("app_user_profiles", {
        filter: {
            _and: [
                { user_id: { _eq: normalizedUserId } },
                { profile_public: { _eq: true } },
            ],
        } as JsonObject,
        limit: 1,
    });
    const profile = rows[0] || null;
    void cacheManager.set("profile-viewer", cacheKey, {
        exists: true,
        profile,
    });
    return profile;
}

/**
 * 按 userId 为指定访问者加载资料。
 * owner 始终可见；非 owner 仅在 profile_public=true 时可见。
 */
export async function loadProfileForViewerByUserId(
    userId: string,
    viewerId?: string | null,
): Promise<AppProfile | null> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
        return null;
    }
    const normalizedViewerId = String(viewerId || "").trim();
    const isOwner =
        Boolean(normalizedViewerId) && normalizedViewerId === normalizedUserId;
    if (isOwner) {
        const cacheKey = `owner:${normalizedUserId}`;
        const cached = await cacheManager.get<{
            exists: boolean;
            profile: AppProfile | null;
        }>("profile-viewer", cacheKey);
        if (cached) {
            return cached.profile;
        }
        const rows = await readMany("app_user_profiles", {
            filter: { user_id: { _eq: normalizedUserId } } as JsonObject,
            limit: 1,
        });
        const profile = (rows[0] as AppProfile | undefined) ?? null;
        void cacheManager.set("profile-viewer", cacheKey, {
            exists: true,
            profile,
        });
        return profile;
    }
    return loadPublicProfileByUserId(normalizedUserId);
}

export function invalidateOfficialSidebarCache(): void {
    void cacheManager.invalidate("sidebar", "official");
}

export async function loadOfficialSidebarProfile(): Promise<SidebarProfileData> {
    const cached = await cacheManager.get<SidebarProfileData>(
        "sidebar",
        "official",
    );
    if (cached) {
        return cached;
    }

    const rows = await readMany("app_user_profiles", {
        filter: {
            _and: [
                { is_official: { _eq: true } },
                { profile_public: { _eq: true } },
            ],
        } as JsonObject,
        limit: 1,
    });

    const profile = rows[0] as AppProfile | undefined;
    if (!profile) {
        return {
            display_name: "CiaLli",
            bio: null,
            bio_typewriter_enable: true,
            bio_typewriter_speed: 80,
            avatar_url: null,
            username: null,
            social_links: null,
            is_official: true,
        };
    }

    const data = profileToSidebarData(profile);
    void cacheManager.set("sidebar", "official", data);
    return data;
}
