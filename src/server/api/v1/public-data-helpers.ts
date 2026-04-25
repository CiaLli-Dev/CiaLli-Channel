import type {
    AppAlbum,
    AppArticle,
    AppDiary,
    AppProfile,
    AppProfileView,
    SidebarProfileData,
} from "@/types/app";
import type { JsonObject } from "@/types/json";
import type {
    BangumiCollectionStatus,
    BangumiListResult,
} from "@/server/bangumi/types";
import { cacheManager } from "@/server/cache/manager";
import { loadBangumiCollections } from "@/server/bangumi/service";
import { decryptBangumiAccessToken } from "@/server/bangumi/token";
import { normalizeBangumiId } from "@/server/bangumi/username";
import { buildPublicAssetUrl } from "@/server/directus-auth";
import {
    fetchDiaryCommentCountMapFromRepository,
    fetchDiaryLikeCountMapFromRepository,
    listHomeAlbumsFromRepository,
    listHomeArticlesFromRepository,
    listHomeDiariesFromRepository,
    loadAdministratorSidebarFallbackSourceFromRepository,
    loadProfileViewByFilterFromRepository,
} from "@/server/repositories/public/public-data.repository";

import type { AuthorBundleItem } from "./shared/author-cache";
import { getAuthorBundle } from "./shared/author-cache";
import { filterPublicStatus } from "./shared/auth";
import { excludeSpecialArticleSlugFilter, safeCsv } from "./shared/helpers";

// ---------------------------------------------------------------------------
// 过滤条件生成
// ---------------------------------------------------------------------------

/** 文章过滤：非 owner 仅按公开状态过滤 */
export function articleFilters(isOwner: boolean): JsonObject[] {
    return isOwner
        ? [{ status: { _eq: "published" } }, excludeSpecialArticleSlugFilter()]
        : [filterPublicStatus(), excludeSpecialArticleSlugFilter()];
}

/** 日记过滤：非 owner 仅按发布且非私有过滤 */
export function diaryFilters(isOwner: boolean): JsonObject[] {
    return isOwner
        ? [{ status: { _eq: "published" } }]
        : [{ status: { _eq: "published" } }, { praviate: { _eq: true } }];
}

/** 相册过滤：非 owner 仅按公开条件过滤 */
export function albumFilters(isOwner: boolean): JsonObject[] {
    return isOwner ? [] : [filterPublicStatus()];
}

// ---------------------------------------------------------------------------
// Bangumi 加载
// ---------------------------------------------------------------------------

export async function loadBangumiListForProfile(
    profile: AppProfile,
    options?: {
        limit?: number;
        page?: number;
        status?: BangumiCollectionStatus;
        includePrivate?: boolean;
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
        includePrivate:
            options?.includePrivate ?? Boolean(profile.bangumi_include_private),
        accessToken: decryptBangumiAccessToken(
            profile.bangumi_access_token_encrypted,
        ),
    });
}

// ---------------------------------------------------------------------------
// 日记统计数据
// ---------------------------------------------------------------------------

export async function fetchDiaryCommentCountMap(
    diaryIds: string[],
): Promise<Map<string, number>> {
    return await fetchDiaryCommentCountMapFromRepository(diaryIds);
}

export async function fetchDiaryLikeCountMap(
    diaryIds: string[],
): Promise<Map<string, number>> {
    return await fetchDiaryLikeCountMapFromRepository(diaryIds);
}

// ---------------------------------------------------------------------------
// profile 公共资料
// ---------------------------------------------------------------------------

export function profileToSidebarData(
    profile: AppProfileView,
): SidebarProfileData {
    const avatarUrl = profile.avatar_file
        ? buildPublicAssetUrl(profile.avatar_file)
        : null;

    return {
        display_name: profile.display_name || profile.username || "user",
        bio: profile.bio,
        avatar_url: avatarUrl,
        username: profile.username || null,
        social_links: profile.social_links ?? null,
        is_official: profile.is_official ?? false,
    };
}

// ---------------------------------------------------------------------------
// 首页数据并发加载辅助
// ---------------------------------------------------------------------------

type HomeDataParallelOptions = {
    targetUserId: string;
    profile: AppProfile;
};

type HomeDataParallelResult = {
    authorMap: Map<string, AuthorBundleItem>;
    articles: AppArticle[];
    diaries: AppDiary[];
    bangumi: import("@/server/bangumi/types").BangumiCollectionItem[];
    albums: AppAlbum[];
};

export async function loadHomeDataInParallel(
    opts: HomeDataParallelOptions,
): Promise<HomeDataParallelResult> {
    const { targetUserId, profile } = opts;

    const [authorMap, articles, diaries, bangumi, albums] = await Promise.all([
        getAuthorBundle([targetUserId]),
        profile.show_articles_on_profile
            ? listHomeArticlesFromRepository({
                  targetUserId,
                  filters: articleFilters(false),
              })
            : Promise.resolve([] as AppArticle[]),
        profile.show_diaries_on_profile
            ? listHomeDiariesFromRepository({
                  targetUserId,
                  filters: diaryFilters(false),
              })
            : Promise.resolve([] as AppDiary[]),
        profile.show_bangumi_on_profile
            ? loadBangumiListForProfile(profile, {
                  limit: 20,
                  includePrivate: false,
              }).then(
                  // 个人主页公共快照不允许回带 Bangumi 私有收藏。
                  (result) => result.items,
              )
            : Promise.resolve(
                  [] as import("@/server/bangumi/types").BangumiCollectionItem[],
              ),
        profile.show_albums_on_profile
            ? listHomeAlbumsFromRepository({
                  targetUserId,
                  filters: albumFilters(false),
              })
            : Promise.resolve([] as AppAlbum[]),
    ]);

    return {
        authorMap,
        articles: articles as AppArticle[],
        diaries: diaries as AppDiary[],
        bangumi,
        albums: albums as AppAlbum[],
    };
}

// ---------------------------------------------------------------------------
// 构建 owner 数据对象
// ---------------------------------------------------------------------------

type OwnerDataOptions = {
    targetUserId: string;
    profile: AppProfileView;
    author: AuthorBundleItem;
};

export function buildOwnerData(opts: OwnerDataOptions): {
    id: string;
    name: string;
    username?: string;
    avatar_url?: string;
    header_url?: string;
} {
    const { targetUserId, profile, author } = opts;
    return {
        id: targetUserId,
        name: profile.display_name || profile.username || author.name || "user",
        username: profile.username || author.username,
        avatar_url: profile.avatar_file
            ? buildPublicAssetUrl(profile.avatar_file, {
                  width: 128,
                  height: 128,
                  fit: "cover",
              })
            : author.avatar_url,
        header_url: profile.header_file
            ? buildPublicAssetUrl(profile.header_file, {
                  width: 1200,
                  height: 400,
                  fit: "cover",
              })
            : undefined,
    };
}

// ---------------------------------------------------------------------------
// 官方 Sidebar 缓存
// ---------------------------------------------------------------------------

const SIDEBAR_OFFICIAL_CACHE_KEY = "official:v2";
const SIDEBAR_OFFICIAL_LEGACY_CACHE_KEY = "official";

export async function invalidateOfficialSidebarCacheAsync(): Promise<void> {
    await Promise.all([
        cacheManager.invalidate("sidebar", SIDEBAR_OFFICIAL_CACHE_KEY),
        cacheManager.invalidate("sidebar", SIDEBAR_OFFICIAL_LEGACY_CACHE_KEY),
    ]);
}

export function invalidateOfficialSidebarCache(): void {
    void invalidateOfficialSidebarCacheAsync();
}

async function loadProfileViewByFilter(
    filter: JsonObject,
): Promise<AppProfileView | null> {
    return await loadProfileViewByFilterFromRepository(filter);
}

export async function loadOfficialSidebarProfile(): Promise<SidebarProfileData> {
    const cached = await cacheManager.get<SidebarProfileData>(
        "sidebar",
        SIDEBAR_OFFICIAL_CACHE_KEY,
    );
    if (cached) {
        return cached;
    }

    // 兜底优先级：平台 Administrator 的公开 profile -> 公开官方档案 -> 字面量默认值。
    // 当前服务 token 无法稳定读取 directus_users 明细，因此兜底只消费可公开展示的 profile。
    const administratorSource =
        await loadAdministratorSidebarFallbackSourceFromRepository();
    if (administratorSource) {
        const data = profileToSidebarData(administratorSource.profile);
        void cacheManager.set("sidebar", SIDEBAR_OFFICIAL_CACHE_KEY, data);
        return data;
    }

    const profile = await loadProfileViewByFilter({
        _and: [
            { is_official: { _eq: true } },
            { profile_public: { _eq: true } },
        ],
    } as JsonObject);
    if (!profile) {
        return {
            display_name: "CiaLli",
            bio: null,
            avatar_url: null,
            username: null,
            social_links: null,
            is_official: true,
        };
    }

    const data = profileToSidebarData(profile);
    void cacheManager.set("sidebar", SIDEBAR_OFFICIAL_CACHE_KEY, data);
    return data;
}

// ---------------------------------------------------------------------------
// 分页参数解析
// ---------------------------------------------------------------------------

export function parsePaginationParams(
    page: number | undefined,
    limit: number | undefined,
    maxLimit: number,
): { page: number; limit: number; offset: number } {
    const validPage = page && page > 0 ? Math.floor(page) : 1;
    const validLimit =
        limit && limit > 0 ? Math.min(maxLimit, Math.floor(limit)) : 20;
    return {
        page: validPage,
        limit: validLimit,
        offset: (validPage - 1) * validLimit,
    };
}

export { safeCsv };

// ---------------------------------------------------------------------------
// 按 userId 加载资料（带缓存）
// ---------------------------------------------------------------------------

export async function loadPublicProfileByUserId(
    userId: string,
): Promise<AppProfileView | null> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
        return null;
    }
    const cacheKey = `public:${normalizedUserId}`;
    const cached = await cacheManager.get<{
        exists: boolean;
        profile: AppProfileView | null;
    }>("profile-viewer", cacheKey);
    if (cached) {
        return cached.profile;
    }

    const profile = await loadProfileViewByFilter({
        _and: [
            { user_id: { _eq: normalizedUserId } },
            { profile_public: { _eq: true } },
        ],
    } as JsonObject);
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
): Promise<AppProfileView | null> {
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
            profile: AppProfileView | null;
        }>("profile-viewer", cacheKey);
        if (cached) {
            return cached.profile;
        }
        const profile = await loadProfileViewByFilter({
            user_id: { _eq: normalizedUserId },
        } as JsonObject);
        void cacheManager.set("profile-viewer", cacheKey, {
            exists: true,
            profile,
        });
        return profile;
    }
    return loadPublicProfileByUserId(normalizedUserId);
}

// ---------------------------------------------------------------------------
// 公共类型（被 public-data.ts 和 helpers 共用）
// ---------------------------------------------------------------------------

export type ContentLoadResult<T> =
    | { status: "ok"; data: T }
    | { status: "not_found" }
    | { status: "permission_denied"; reason: string };

export type ViewerOptions = { viewerId?: string | null };

export type PaginatedResult<T> = {
    items: T[];
    page: number;
    limit: number;
    total: number;
};
