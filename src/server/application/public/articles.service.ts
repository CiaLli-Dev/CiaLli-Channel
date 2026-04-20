import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import { fail, ok } from "@/server/api/response";
import { parsePagination } from "@/server/api/utils";
import {
    excludeSpecialArticleSlugFilter,
    filterPublicStatus,
    isSpecialArticleSlug,
    loadPublicArticleById,
    loadPublicArticleBySlug,
    parseRouteId,
    safeCsv,
} from "@/server/api/v1/shared";
import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import {
    countItems,
    countItemsGroupedByField,
    readMany,
    runWithDirectusServiceAccess,
} from "@/server/directus/client";
import {
    buildArticleFeedEntry,
    normalizeIdentity,
} from "@/server/application/feed/feed-entry-helpers";
import { buildPostUrl } from "@/utils/content-post-helpers";
import type { DirectusPostEntry } from "@/utils/content-utils";

import {
    loadProfileByUsername,
    normalizeAuthorHandle,
    readAuthor,
} from "@/server/api/v1/public/_helpers";

const DEFAULT_PUBLIC_ARTICLE_LIST_LIMIT = 20;
const MAX_PUBLIC_ARTICLE_LIST_LIMIT = 20;
const ARTICLE_TAXONOMY_CACHE_KEY = "public";
export const UNCATEGORIZED_ARTICLE_CATEGORY = "uncategorized";

export type PublicArticleTag = {
    name: string;
    count: number;
};

export type PublicArticleCategory = {
    name: string;
    count: number;
    url: string;
};

export type PublicArticleListInput = {
    page: number;
    limit: number;
    tags?: string[];
    category?: string | null;
    q?: string | null;
    authorHandle?: string | null;
    bypassCache?: boolean;
};

export type PublicArticleListResult = {
    items: DirectusPostEntry[];
    page: number;
    limit: number;
    total: number;
};

export type PublicArticleTaxonomyResult = {
    tags: PublicArticleTag[];
    categories: PublicArticleCategory[];
};

export type PublicArticleStatsResult = PublicArticleTaxonomyResult & {
    total: number;
};

export type PublicArticleCalendarEntry = {
    id: string;
    title: string;
    url: string;
    date: string;
};

function normalizeListQueryValue(
    value: string | null | undefined,
    maxLength: number,
): string | null {
    const normalized = String(value || "")
        .trim()
        .slice(0, maxLength);
    return normalized || null;
}

function buildPublicArticleCacheKey(input: PublicArticleListInput): string {
    return hashParams({
        page: input.page,
        limit: input.limit,
        tags: input.tags || [],
        category: input.category || null,
        q: input.q || null,
        author: input.authorHandle || null,
    });
}

function normalizeTagQueryValues(searchParams: URLSearchParams): string[] {
    return Array.from(
        new Set(
            searchParams
                .getAll("tag")
                .flatMap((value) => value.split(","))
                .map((value) => value.trim().slice(0, 200))
                .filter(Boolean),
        ),
    );
}

function buildPublicArticleBaseFilters(): JsonObject[] {
    return [filterPublicStatus(), excludeSpecialArticleSlugFilter()];
}

async function buildArticleListFilters(input: {
    page: number;
    limit: number;
    tags: string[];
    category: string | null;
    q: string | null;
    authorHandle: string | null;
}): Promise<{ filters: JsonObject[]; earlyReturn?: PublicArticleListResult }> {
    const andFilters: JsonObject[] = buildPublicArticleBaseFilters();

    if (input.authorHandle) {
        const profile = await loadProfileByUsername(input.authorHandle);
        if (!profile?.user_id) {
            return {
                filters: andFilters,
                earlyReturn: {
                    items: [],
                    page: input.page,
                    limit: input.limit,
                    total: 0,
                },
            };
        }
        andFilters.push({ author_id: { _eq: profile.user_id } });
    }
    for (const tag of input.tags) {
        andFilters.push({ tags: { _contains: tag } });
    }
    if (input.category) {
        if (input.category === UNCATEGORIZED_ARTICLE_CATEGORY) {
            andFilters.push({
                _or: [{ category: { _null: true } }, { category: { _eq: "" } }],
            });
        } else {
            andFilters.push({ category: { _eq: input.category } });
        }
    }
    if (input.q) {
        andFilters.push({
            _or: [
                { title: { _icontains: input.q } },
                { summary: { _icontains: input.q } },
            ],
        });
    }

    return { filters: andFilters };
}

async function fetchPublicArticleInteractionCountMap(
    collection: "app_article_likes" | "app_article_comments",
    articleIds: string[],
    options?: { requirePublic?: boolean },
): Promise<Map<string, number>> {
    if (articleIds.length === 0) {
        return new Map();
    }

    const filters: JsonObject[] = [
        { article_id: { _in: articleIds } },
        { status: { _eq: "published" } },
    ];
    if (options?.requirePublic) {
        filters.push({ is_public: { _eq: true } });
    }

    return await countItemsGroupedByField(collection, "article_id", {
        _and: filters,
    } as JsonObject);
}

function buildCategoryUrl(category: string): string {
    if (category === UNCATEGORIZED_ARTICLE_CATEGORY) {
        return "/posts?uncategorized=1";
    }
    return `/posts?category=${encodeURIComponent(category)}`;
}

function buildPublicArticleTags(
    rows: Array<{ tags?: string[] | null }>,
): PublicArticleTag[] {
    const tagCountMap = new Map<string, number>();

    for (const row of rows) {
        for (const tag of safeCsv(row.tags ?? null)) {
            tagCountMap.set(tag, (tagCountMap.get(tag) || 0) + 1);
        }
    }

    return Array.from(tagCountMap.entries())
        .sort(([left], [right]) =>
            left.toLowerCase().localeCompare(right.toLowerCase()),
        )
        .map(([name, count]) => ({ name, count }));
}

function buildPublicArticleCategories(
    rows: Array<{ category?: string | null }>,
): PublicArticleCategory[] {
    const categoryCountMap = new Map<string, number>();

    for (const row of rows) {
        const normalizedCategory = String(row.category || "").trim();
        const categoryKey =
            normalizedCategory || UNCATEGORIZED_ARTICLE_CATEGORY;
        categoryCountMap.set(
            categoryKey,
            (categoryCountMap.get(categoryKey) || 0) + 1,
        );
    }

    return Array.from(categoryCountMap.entries())
        .sort(([left], [right]) =>
            left.toLowerCase().localeCompare(right.toLowerCase()),
        )
        .map(([name, count]) => ({
            name,
            count,
            url: buildCategoryUrl(name),
        }));
}

export async function getPublicArticleTaxonomyData(options?: {
    bypassCache?: boolean;
}): Promise<PublicArticleTaxonomyResult> {
    return await runWithDirectusServiceAccess(async () => {
        if (options?.bypassCache !== true) {
            const cached = await cacheManager.get<PublicArticleTaxonomyResult>(
                "article-taxonomy",
                ARTICLE_TAXONOMY_CACHE_KEY,
            );
            if (cached) {
                return cached;
            }
        }

        // taxonomy 只读取标签/分类轻字段，避免列表页为侧栏聚合拉整篇文章数据。
        const rows = await readMany("app_articles", {
            filter: {
                _and: buildPublicArticleBaseFilters(),
            } as JsonObject,
            fields: ["tags", "category"],
            limit: -1,
        });

        const result: PublicArticleTaxonomyResult = {
            tags: buildPublicArticleTags(rows),
            categories: buildPublicArticleCategories(rows),
        };
        if (options?.bypassCache !== true) {
            void cacheManager.set(
                "article-taxonomy",
                ARTICLE_TAXONOMY_CACHE_KEY,
                result,
            );
        }
        return result;
    });
}

export async function getPublicArticleStatsData(): Promise<PublicArticleStatsResult> {
    return await runWithDirectusServiceAccess(async () => {
        const filter = {
            _and: buildPublicArticleBaseFilters(),
        } as JsonObject;
        const [taxonomy, total] = await Promise.all([
            getPublicArticleTaxonomyData(),
            countItems("app_articles", filter),
        ]);
        return {
            total,
            tags: taxonomy.tags,
            categories: taxonomy.categories,
        };
    });
}

export async function getPublicArticleCalendarEntries(): Promise<
    PublicArticleCalendarEntry[]
> {
    return await runWithDirectusServiceAccess(async () => {
        // 日历接口只消费标题、路由和日期，避免再走文章卡片聚合链路。
        const rows = await readMany("app_articles", {
            filter: {
                _and: buildPublicArticleBaseFilters(),
            } as JsonObject,
            fields: ["id", "short_id", "title", "date_created"],
            sort: ["-date_created"],
            limit: -1,
        });

        return rows
            .map((row) => {
                const articleId = normalizeIdentity(row.id);
                const shortId = normalizeIdentity(row.short_id) || null;
                const routeId = shortId || articleId;
                const title =
                    String(row.title || "").trim() || routeId || articleId;
                const createdAt = new Date(String(row.date_created || ""));
                if (
                    !articleId ||
                    !routeId ||
                    Number.isNaN(createdAt.getTime()) ||
                    !title
                ) {
                    return null;
                }
                const year = createdAt.getFullYear();
                const month = String(createdAt.getMonth() + 1).padStart(2, "0");
                const day = String(createdAt.getDate()).padStart(2, "0");
                return {
                    id: articleId,
                    title,
                    url: buildPostUrl(shortId, articleId),
                    date: `${year}-${month}-${day}`,
                } satisfies PublicArticleCalendarEntry;
            })
            .filter(
                (entry): entry is PublicArticleCalendarEntry => entry !== null,
            );
    });
}

export async function getPublicArticleListData(
    input: PublicArticleListInput,
): Promise<PublicArticleListResult> {
    return await runWithDirectusServiceAccess(async () => {
        const cacheKey = buildPublicArticleCacheKey(input);
        if (input.bypassCache !== true) {
            const cached = await cacheManager.get<PublicArticleListResult>(
                "article-list",
                cacheKey,
            );
            if (cached) {
                return cached;
            }
        }

        const { filters, earlyReturn } = await buildArticleListFilters({
            page: input.page,
            limit: input.limit,
            tags: input.tags || [],
            category: input.category || null,
            q: input.q || null,
            authorHandle: input.authorHandle || null,
        });
        if (earlyReturn) {
            return earlyReturn;
        }

        const filter = { _and: filters } as JsonObject;
        const offset = (input.page - 1) * input.limit;
        const [rows, total] = await Promise.all([
            readMany("app_articles", {
                filter,
                sort: ["-date_updated", "-date_created"],
                fields: [
                    "id",
                    "short_id",
                    "author_id",
                    "status",
                    "title",
                    "slug",
                    "summary",
                    "cover_file",
                    "cover_url",
                    "tags",
                    "category",
                    "is_public",
                    "date_created",
                    "date_updated",
                ],
                limit: input.limit,
                offset,
            }),
            countItems("app_articles", filter),
        ]);

        const articleIds = Array.from(
            new Set(
                rows.map((row) => normalizeIdentity(row.id)).filter(Boolean),
            ),
        );
        const authorIds = Array.from(
            new Set(
                rows
                    .map((row) => normalizeIdentity(row.author_id))
                    .filter(Boolean),
            ),
        );
        const [authorMap, articleLikeCountMap, articleCommentCountMap] =
            await Promise.all([
                getAuthorBundle(authorIds),
                fetchPublicArticleInteractionCountMap(
                    "app_article_likes",
                    articleIds,
                ),
                fetchPublicArticleInteractionCountMap(
                    "app_article_comments",
                    articleIds,
                    {
                        requirePublic: true,
                    },
                ),
            ]);

        const items = rows
            .map((row) =>
                buildArticleFeedEntry(
                    row,
                    authorMap,
                    articleLikeCountMap,
                    articleCommentCountMap,
                ),
            )
            .filter((entry): entry is DirectusPostEntry => entry !== null);

        const result: PublicArticleListResult = {
            items,
            page: input.page,
            limit: input.limit,
            total,
        };
        if (input.bypassCache !== true) {
            void cacheManager.set("article-list", cacheKey, result);
        }
        return result;
    });
}

export function parsePublicArticleListInput(
    url: URL,
    options?: {
        defaultLimit?: number;
        maxLimit?: number;
        bypassCache?: boolean;
    },
): PublicArticleListInput {
    const { page, limit } = parsePagination(url, {
        defaultLimit:
            options?.defaultLimit ?? DEFAULT_PUBLIC_ARTICLE_LIST_LIMIT,
        maxLimit: options?.maxLimit ?? MAX_PUBLIC_ARTICLE_LIST_LIMIT,
    });

    return {
        page,
        limit,
        tags: normalizeTagQueryValues(url.searchParams),
        category: url.searchParams.has("uncategorized")
            ? UNCATEGORIZED_ARTICLE_CATEGORY
            : normalizeListQueryValue(url.searchParams.get("category"), 200),
        q: normalizeListQueryValue(url.searchParams.get("q"), 200),
        authorHandle:
            normalizeAuthorHandle(
                (
                    url.searchParams.get("author") ||
                    url.searchParams.get("author_handle") ||
                    ""
                ).slice(0, 100),
            ) || null,
        ...(options?.bypassCache === true ? { bypassCache: true } : {}),
    };
}

async function handleArticleList(context: APIContext): Promise<Response> {
    const result = await getPublicArticleListData(
        parsePublicArticleListInput(context.url),
    );
    return ok(result);
}

async function handleArticleDetail(segments: string[]): Promise<Response> {
    const articleId = parseRouteId(segments[2]);
    if (!articleId) {
        return fail("缺少文章 ID", 400);
    }

    return await runWithDirectusServiceAccess(async () => {
        const cached = await cacheManager.get<unknown>(
            "article-detail",
            articleId,
        );
        if (cached) {
            return ok(cached);
        }

        const articleById = await loadPublicArticleById(articleId);
        const article =
            articleById ||
            (isSpecialArticleSlug(articleId)
                ? await loadPublicArticleBySlug(articleId)
                : null);
        if (!article) {
            return fail("文章不存在", 404);
        }
        const authorMap = await getAuthorBundle([article.author_id]);
        const result = {
            item: {
                ...article,
                tags: safeCsv(article.tags),
                author: readAuthor(authorMap, article.author_id),
            },
        };
        void cacheManager.set("article-detail", articleId, result);
        return ok(result);
    });
}

export async function handlePublicArticlesRoute(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    if (segments.length === 2) {
        return await handleArticleList(context);
    }

    if (segments.length === 3) {
        return await handleArticleDetail(segments);
    }

    return fail("未找到接口", 404);
}
