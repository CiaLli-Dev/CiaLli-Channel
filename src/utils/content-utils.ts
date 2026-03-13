import type {
    AppArticle,
    AppArticleComment,
    AppArticleLike,
    AppProfile,
} from "@/types/app";
import type { JsonObject } from "@/types/json";
import { readMany } from "@/server/directus/client";
import {
    buildDirectusAssetUrl,
    buildPublicAssetUrl,
} from "@/server/directus-auth";
import {
    excludeSpecialArticleSlugFilter,
    filterPublicStatus,
} from "@/server/api/v1/shared";
import { createSingleFlightRunner } from "@/server/utils/single-flight";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import {
    buildPostUrl,
    isProtectedContentBody,
    normalizeTags,
    resolvePublishedAt,
    resolveUpdatedAt,
} from "@/utils/content-post-helpers";
import { getCategoryUrl } from "@utils/url-utils";

type PostAuthor = {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
};

export type Tag = {
    name: string;
    count: number;
};

export type Category = {
    name: string;
    count: number;
    url: string;
};

export type DirectusPostEntry = {
    id: string;
    slug: string | null;
    body: string;
    url: string;
    data: {
        article_id: string;
        author_id: string;
        author: PostAuthor;
        title: string;
        description?: string;
        image?: string;
        tags: string[];
        category?: string;
        comment_count: number;
        like_count: number;
        published: Date;
        updated: Date;
        nextSlug?: string;
        nextTitle?: string;
        prevSlug?: string;
        prevTitle?: string;
        alias?: string;
        permalink?: string;
        encrypted?: boolean;
    };
};

export function resolveArticleDisplayTitle(
    article: Pick<AppArticle, "title" | "status" | "slug" | "id">,
): string {
    const title = String(article.title || "").trim();
    if (title) {
        return title;
    }
    if (article.status === "draft") {
        return i18n(I18nKey.contentArticleNewDraftTitle);
    }
    const slug = String(article.slug || "").trim();
    return (
        slug || String(article.id || "").trim() || i18n(I18nKey.contentUntitled)
    );
}

export function buildVisiblePostsFilter(viewerId?: string | null): JsonObject {
    const publicBranch = {
        _and: [filterPublicStatus(), excludeSpecialArticleSlugFilter()],
    } satisfies JsonObject;
    const normalizedViewerId = String(viewerId || "").trim();
    if (!normalizedViewerId) {
        return publicBranch;
    }
    return {
        _or: [
            publicBranch,
            {
                _and: [
                    { author_id: { _eq: normalizedViewerId } },
                    { status: { _eq: "draft" } },
                    excludeSpecialArticleSlugFilter(),
                ],
            },
        ],
    } satisfies JsonObject;
}

function resolveCoverImageForViewer(
    post: AppArticle,
    viewerId: string | null,
): string | undefined {
    const coverUrl = post.cover_url ? String(post.cover_url).trim() : "";
    if (coverUrl) {
        return coverUrl;
    }

    const coverFile = post.cover_file ? String(post.cover_file).trim() : "";
    if (!coverFile) {
        return undefined;
    }

    const shouldUseAuthenticatedUrl =
        post.status === "draft" &&
        Boolean(viewerId) &&
        String(post.author_id || "").trim() === viewerId;

    return (
        shouldUseAuthenticatedUrl ? buildDirectusAssetUrl : buildPublicAssetUrl
    )(coverFile, {
        width: 1200,
        height: 675,
        fit: "cover",
    });
}

async function fetchProfilesByUserIds(
    userIds: string[],
): Promise<Map<string, AppProfile>> {
    if (userIds.length === 0) {
        return new Map();
    }
    const profiles = await readMany("app_user_profiles", {
        filter: {
            user_id: { _in: userIds },
        } as JsonObject,
        limit: Math.max(userIds.length, 20),
    });
    const profileMap = new Map<string, AppProfile>();
    for (const profile of profiles) {
        if (profile.user_id) {
            profileMap.set(profile.user_id, profile);
        }
    }
    return profileMap;
}

type AuthorUser = {
    id: string;
    email?: string;
    name?: string;
    avatar?: string | null;
};

async function fetchUsersByIds(
    userIds: string[],
): Promise<Map<string, AuthorUser>> {
    if (userIds.length === 0) {
        return new Map();
    }
    const users = await readMany("directus_users", {
        filter: {
            id: { _in: userIds },
        } as JsonObject,
        limit: Math.max(userIds.length, 20),
        fields: ["id", "email", "first_name", "last_name", "avatar"],
    });

    const userMap = new Map<string, AuthorUser>();
    for (const user of users) {
        const fullName = [user.first_name, user.last_name]
            .map((entry) => (entry || "").trim())
            .filter(Boolean)
            .join(" ")
            .trim();
        userMap.set(user.id, {
            id: user.id,
            email: user.email || undefined,
            name: fullName || undefined,
            avatar: user.avatar,
        });
    }
    return userMap;
}

function resolveUsername(
    profile: AppProfile | undefined,
    userId: string,
): string {
    const rawUsername = String(profile?.username || "").trim();
    const usernameWithoutDomain = rawUsername.includes("@")
        ? (rawUsername.split("@")[0] || "").trim()
        : rawUsername;
    return usernameWithoutDomain || `user-${String(userId || "").slice(0, 8)}`;
}

function resolveDisplayName(
    profile: AppProfile | undefined,
    user: AuthorUser | undefined,
    username: string,
): string {
    return (
        String(profile?.display_name || "").trim() ||
        user?.name?.trim() ||
        username ||
        "Member"
    );
}

function resolveAvatarUrl(
    _profile: AppProfile | undefined,
    user: AuthorUser | undefined,
): string | undefined {
    if (user?.avatar) {
        return buildPublicAssetUrl(user.avatar, {
            width: 96,
            height: 96,
            fit: "cover",
        });
    }
    return undefined;
}

function buildAuthor(
    userId: string,
    profileMap: Map<string, AppProfile>,
    userMap: Map<string, AuthorUser>,
): PostAuthor {
    const profile = profileMap.get(userId);
    const user = userMap.get(userId);

    const username = resolveUsername(profile, userId);
    const displayName = resolveDisplayName(profile, user, username);
    const name = displayName || username || "Member";
    const avatarUrl = resolveAvatarUrl(profile, user);

    return {
        id: userId,
        name,
        display_name: displayName || username || "Member",
        username,
        avatar_url: avatarUrl,
    };
}

function buildArticleCountMap<T extends { article_id: string }>(
    rows: T[],
): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
        const articleId = String(row.article_id || "").trim();
        if (!articleId) {
            continue;
        }
        map.set(articleId, (map.get(articleId) || 0) + 1);
    }
    return map;
}

async function fetchArticleCommentCountMap(
    articleIds: string[],
): Promise<Map<string, number>> {
    if (articleIds.length === 0) {
        return new Map();
    }
    try {
        const comments = await readMany("app_article_comments", {
            filter: {
                _and: [
                    { article_id: { _in: articleIds } },
                    { status: { _eq: "published" } },
                    { is_public: { _eq: true } },
                ],
            } as JsonObject,
            limit: Math.max(articleIds.length * 20, 200),
            fields: ["article_id"],
        });
        return buildArticleCountMap(comments as AppArticleComment[]);
    } catch (error) {
        console.warn(
            "[content-utils] failed to load article comment counts:",
            error,
        );
        return new Map();
    }
}

async function fetchArticleLikeCountMap(
    articleIds: string[],
): Promise<Map<string, number>> {
    if (articleIds.length === 0) {
        return new Map();
    }
    try {
        const likes = await readMany("app_article_likes", {
            filter: {
                _and: [
                    { article_id: { _in: articleIds } },
                    { status: { _eq: "published" } },
                ],
            } as JsonObject,
            limit: Math.max(articleIds.length * 20, 200),
            fields: ["article_id"],
        });
        return buildArticleCountMap(likes as AppArticleLike[]);
    } catch (error) {
        console.warn(
            "[content-utils] failed to load article like counts:",
            error,
        );
        return new Map();
    }
}

type PostMappingContext = {
    profileMap: Map<string, AppProfile>;
    userMap: Map<string, AuthorUser>;
    commentCountMap: Map<string, number>;
    likeCountMap: Map<string, number>;
    viewerId: string | null;
};

type PostIds = {
    normalizedSlug: string;
    slug: string | null;
    title: string;
    category: string;
    articleId: string;
    authorId: string;
    shortId: string | null;
    routeId: string;
};

type DerivedBlogData = {
    posts: DirectusPostEntry[];
    tags: Tag[];
    categories: Category[];
};

type DerivedBlogDataCacheEntry = {
    expiresAt: number;
    data: DerivedBlogData;
};

const DERIVED_BLOG_DATA_CACHE_TTL_MS = 15_000;
const derivedBlogDataCache = new Map<string, DerivedBlogDataCacheEntry>();

function buildDerivedBlogDataCacheKey(viewerId?: string | null): string {
    const normalizedViewerId = String(viewerId || "").trim();
    return normalizedViewerId ? `viewer:${normalizedViewerId}` : "viewer:guest";
}

function readDerivedBlogDataCache(key: string): DerivedBlogData | null {
    const cached = derivedBlogDataCache.get(key);
    if (!cached) {
        return null;
    }
    if (cached.expiresAt <= Date.now()) {
        derivedBlogDataCache.delete(key);
        return null;
    }
    return cached.data;
}

function writeDerivedBlogDataCache(key: string, data: DerivedBlogData): void {
    derivedBlogDataCache.set(key, {
        expiresAt: Date.now() + DERIVED_BLOG_DATA_CACHE_TTL_MS,
        data,
    });
}

function extractPostIds(post: AppArticle): PostIds {
    const normalizedSlug = String(post.slug || "").trim();
    const slug = normalizedSlug || null;
    const title = String(post.title || "").trim();
    const category = post.category ? String(post.category).trim() : "";
    const articleId = String(post.id || "").trim();
    const authorId = String(post.author_id || "").trim();
    const shortId = String(post.short_id || "").trim() || null;
    const routeId = shortId || articleId || normalizedSlug;
    return {
        normalizedSlug,
        slug,
        title,
        category,
        articleId,
        authorId,
        shortId,
        routeId,
    };
}

function buildPostData(
    post: AppArticle,
    ids: PostIds,
    ctx: PostMappingContext,
): DirectusPostEntry["data"] {
    const { articleId, authorId, category } = ids;
    return {
        article_id: articleId,
        author_id: authorId,
        author: buildAuthor(authorId, ctx.profileMap, ctx.userMap),
        title: resolveArticleDisplayTitle(post),
        description: post.summary || undefined,
        image: resolveCoverImageForViewer(post, ctx.viewerId),
        tags: normalizeTags(post.tags),
        category: category || undefined,
        comment_count: ctx.commentCountMap.get(articleId) || 0,
        like_count: ctx.likeCountMap.get(articleId) || 0,
        published: resolvePublishedAt(post),
        updated: resolveUpdatedAt(post),
        encrypted: isProtectedContentBody(post.body_markdown),
    };
}

function mapPostToEntry(
    post: AppArticle,
    ctx: PostMappingContext,
): DirectusPostEntry {
    const ids = extractPostIds(post);
    return {
        id: ids.routeId,
        slug: ids.slug,
        body: String(post.body_markdown || ""),
        url: buildPostUrl(ids.shortId, ids.articleId),
        data: buildPostData(post, ids, ctx),
    } satisfies DirectusPostEntry;
}

async function loadDirectusPosts(
    viewerId?: string | null,
): Promise<DirectusPostEntry[]> {
    try {
        const rows = await readMany("app_articles", {
            filter: buildVisiblePostsFilter(viewerId),
            sort: ["-date_updated", "-date_created"],
            limit: 1000,
        });

        const articleIds = rows
            .map((row) => String(row.id || "").trim())
            .filter(Boolean);
        const authorIds = Array.from(
            new Set(
                rows
                    .map((row) => String(row.author_id || "").trim())
                    .filter(Boolean),
            ),
        );
        const [profileMap, userMap, commentCountMap, likeCountMap] =
            await Promise.all([
                fetchProfilesByUserIds(authorIds),
                fetchUsersByIds(authorIds),
                fetchArticleCommentCountMap(articleIds),
                fetchArticleLikeCountMap(articleIds),
            ]);

        const ctx: PostMappingContext = {
            profileMap,
            userMap,
            commentCountMap,
            likeCountMap,
            viewerId: String(viewerId || "").trim() || null,
        };

        const mapped = rows.map((post) => mapPostToEntry(post, ctx));

        return mapped.sort(
            (a, b) => b.data.published.getTime() - a.data.published.getTime(),
        );
    } catch (error) {
        console.warn(
            "[content-utils] failed to load posts from Directus:",
            error,
        );
        return [];
    }
}

function withAdjacentPostLinks(
    posts: DirectusPostEntry[],
): DirectusPostEntry[] {
    for (let i = 1; i < posts.length; i += 1) {
        posts[i].data.nextSlug = posts[i - 1].id;
        posts[i].data.nextTitle = posts[i - 1].data.title;
    }
    for (let i = 0; i < posts.length - 1; i += 1) {
        posts[i].data.prevSlug = posts[i + 1].id;
        posts[i].data.prevTitle = posts[i + 1].data.title;
    }
    return posts;
}

function buildTagListFromPosts(posts: DirectusPostEntry[]): Tag[] {
    const countMap: Record<string, number> = {};

    for (const post of posts) {
        for (const tag of post.data.tags ?? []) {
            if (!countMap[tag]) {
                countMap[tag] = 0;
            }
            countMap[tag] += 1;
        }
    }

    const keys = Object.keys(countMap).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
    );

    return keys.map((key) => ({ name: key, count: countMap[key] }));
}

function buildCategoryListFromPosts(posts: DirectusPostEntry[]): Category[] {
    const count: Record<string, number> = {};

    for (const post of posts) {
        if (!post.data.category) {
            const uncategorizedKey = i18n(I18nKey.contentUncategorized);
            count[uncategorizedKey] = (count[uncategorizedKey] || 0) + 1;
            continue;
        }
        const categoryName = String(post.data.category).trim();
        count[categoryName] = (count[categoryName] || 0) + 1;
    }

    const categories = Object.keys(count).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
    );

    return categories.map((category) => ({
        name: category,
        count: count[category],
        url: getCategoryUrl(category),
    }));
}

const loadDerivedBlogDataSingleFlight = createSingleFlightRunner(
    async (
        cacheKey: string,
        viewerId?: string | null,
    ): Promise<DerivedBlogData> => {
        const posts = withAdjacentPostLinks(await loadDirectusPosts(viewerId));
        const data: DerivedBlogData = {
            posts,
            tags: buildTagListFromPosts(posts),
            categories: buildCategoryListFromPosts(posts),
        };
        writeDerivedBlogDataCache(cacheKey, data);
        return data;
    },
    (cacheKey: string) => cacheKey,
);

async function loadDerivedBlogData(
    viewerId?: string | null,
): Promise<DerivedBlogData> {
    const cacheKey = buildDerivedBlogDataCacheKey(viewerId);
    const cached = readDerivedBlogDataCache(cacheKey);
    if (cached) {
        return cached;
    }
    return await loadDerivedBlogDataSingleFlight(cacheKey, viewerId);
}

export async function getSortedPosts(
    viewerId?: string | null,
): Promise<DirectusPostEntry[]> {
    return (await loadDerivedBlogData(viewerId)).posts;
}

export type PostForList = {
    id: string;
    data: DirectusPostEntry["data"];
    url?: string;
};

export async function getSortedPostsList(
    viewerId?: string | null,
): Promise<PostForList[]> {
    const sortedFullPosts = (await loadDerivedBlogData(viewerId)).posts;
    return sortedFullPosts.map((post) => ({
        id: post.id,
        data: post.data,
        url: post.url,
    }));
}

export async function getTagList(viewerId?: string | null): Promise<Tag[]> {
    return (await loadDerivedBlogData(viewerId)).tags;
}

export async function getCategoryList(
    viewerId?: string | null,
): Promise<Category[]> {
    return (await loadDerivedBlogData(viewerId)).categories;
}
