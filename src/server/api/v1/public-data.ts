import type {
    AppAlbum,
    AppAlbumPhoto,
    AppDiary,
    AppDiaryImage,
    AppProfile,
    AppProfileView,
} from "@/types/app";
import type {
    BangumiCollectionItem,
    BangumiCollectionStatus,
} from "@/server/bangumi/types";
import {
    listUserDiariesFromRepository,
    loadDiaryImagesForDiaryFromRepository,
    loadDiaryImagesForIdsFromRepository,
    loadOwnedDiaryByShortIdFromRepository,
    loadProfileViewByUsernameFromRepository,
} from "@/server/repositories/public/public-data.repository";
import { isShortId } from "@/server/utils/short-id";

import type { AuthorBundleItem } from "./shared/author-cache";
import { getAuthorBundle } from "./shared/author-cache";
import { loadPublicDiaryByShortId } from "./shared";
import {
    buildOwnerData,
    diaryFilters,
    fetchDiaryCommentCountMap,
    fetchDiaryLikeCountMap,
    loadBangumiListForProfile,
    loadHomeDataInParallel,
    loadUserAlbumDetailHelper,
    loadUserAlbumListHelper,
    parsePaginationParams,
    safeCsv,
    type ContentLoadResult,
    type ViewerOptions,
} from "./public-data-helpers";

// ---------------------------------------------------------------------------
// Re-exports：保持向后兼容的导出接口
// ---------------------------------------------------------------------------

export {
    invalidateOfficialSidebarCache,
    invalidateOfficialSidebarCacheAsync,
    loadOfficialSidebarProfile,
    loadProfileForViewerByUserId,
    loadPublicProfileByUserId,
    profileToSidebarData,
} from "./public-data-helpers";

// Re-export types for backward compatibility
export type { ContentLoadResult, ViewerOptions } from "./public-data-helpers";

type PublicProfile = Omit<AppProfileView, "bangumi_access_token_encrypted">;

// ---------------------------------------------------------------------------
// 内部工具：按用户名读取资料，不附带 profile_public 限制
// ---------------------------------------------------------------------------

async function loadProfileByUsername(
    username: string,
): Promise<AppProfileView | null> {
    return await loadProfileViewByUsernameFromRepository(username);
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
): Promise<AppProfileView | null> {
    const profile = await loadProfileByUsername(username);
    if (!profile?.profile_public) {
        return null;
    }
    return profile;
}

/**
 * 按指定访问者加载用户资料。
 * owner 始终可见；非 owner 仅在 profile_public=true 时可见。
 */
export async function loadProfileForViewer(
    username: string,
    viewerId?: string | null,
): Promise<AppProfileView | null> {
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
    articles: Array<import("@/types/app").AppArticle & { tags: string[] }>;
    diaries: AppDiary[];
    bangumi: BangumiCollectionItem[];
    albums: Array<AppAlbum & { tags: string[] }>;
};

function toPublicProfile(profile: AppProfileView): PublicProfile {
    const { bangumi_access_token_encrypted: _token, ...rest } = profile;
    return rest;
}

function checkProfileAccess(
    profile: AppProfile,
    isOwnerViewing: boolean,
): { status: "permission_denied"; reason: string } | null {
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }
    return null;
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

    const accessError = checkProfileAccess(profile, isOwnerViewing);
    if (accessError) {
        return accessError;
    }

    const targetUserId = profile.user_id;
    const { authorMap, articles, diaries, bangumi, albums } =
        await loadHomeDataInParallel({
            targetUserId,
            profile,
            isOwnerViewing,
        });

    const owner = readAuthor(authorMap, targetUserId);
    const ownerData = buildOwnerData({ targetUserId, profile, author: owner });

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

    const { page, limit } = parsePaginationParams(
        options.page,
        options.limit,
        200,
    );
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

export type UserDiaryListOptions = {
    page?: number;
    limit?: number;
};

async function loadDiaryImages(
    diaryIds: string[],
    isOwnerViewing: boolean,
): Promise<AppDiaryImage[]> {
    return await loadDiaryImagesForIdsFromRepository(diaryIds, isOwnerViewing);
}

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

    const { page, limit, offset } = parsePaginationParams(
        options.page,
        options.limit,
        100,
    );

    const { rows, total } = await listUserDiariesFromRepository({
        userId,
        filters: diaryFilters(isOwnerViewing),
        limit,
        offset,
    });

    const diaryIds = rows.map((row) => row.id);
    const [images, authorMap, commentCountMap, likeCountMap] =
        await Promise.all([
            loadDiaryImages(diaryIds, isOwnerViewing),
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
        diary = await loadOwnedDiaryByShortIdFromRepository(diaryId);
    } else {
        diary = await loadPublicDiaryByShortId(diaryId);
    }
    if (!diary || diary.author_id !== userId) {
        return { status: "not_found" };
    }
    const [images, authorMap] = await Promise.all([
        loadDiaryImagesForDiaryFromRepository(diary.id, isOwnerViewing),
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
    return loadUserAlbumListHelper(username, options, readAuthor);
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
    return loadUserAlbumDetailHelper(username, albumId, options, readAuthor);
}
