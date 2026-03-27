import type { JsonObject } from "@/types/json";
import type { AppDiaryImage } from "@/types/app";
import {
    DIARY_FIELDS,
    excludeSpecialArticleSlugFilter,
} from "@/server/api/v1/shared";
import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import {
    countItemsGroupedByField,
    readMany,
    runWithDirectusServiceAccess,
} from "@/server/directus/client";
import { createSingleFlightRunner } from "@/server/utils/single-flight";

import type {
    HomeFeedArticleItem,
    HomeFeedBuildOptions,
    HomeFeedBuildResult,
    HomeFeedDiaryEntry,
    HomeFeedDiaryItem,
    HomeFeedItem,
} from "./home-feed.types";
import {
    buildArticleFeedEntry,
    buildDiaryImageMap,
    normalizeIdentity,
    toSafeDate,
} from "./home-feed-helpers";

const DEFAULT_OUTPUT_LIMIT = 60;

type SortableHomeFeedItem = HomeFeedItem & {
    sortCreatedAt: Date;
};

function normalizePositiveInt(
    value: number | undefined,
    fallback: number,
    max: number,
): number {
    const normalized =
        typeof value === "number" && Number.isFinite(value)
            ? Math.floor(value)
            : fallback;
    if (normalized <= 0) {
        return fallback;
    }
    return Math.min(normalized, max);
}

function hydrateHomeFeedItem(item: HomeFeedItem): HomeFeedItem {
    if (item.type === "article") {
        return {
            ...item,
            publishedAt: toSafeDate(item.publishedAt),
            entry: {
                ...item.entry,
                data: {
                    ...item.entry.data,
                    published: toSafeDate(item.entry.data.published),
                    updated: toSafeDate(item.entry.data.updated),
                },
            },
        };
    }

    return {
        ...item,
        publishedAt: toSafeDate(item.publishedAt),
    };
}

function hydrateHomeFeedResult(
    result: HomeFeedBuildResult,
): HomeFeedBuildResult {
    return {
        ...result,
        items: result.items.map((item) => hydrateHomeFeedItem(item)),
    };
}

async function fetchInteractionCountMap(
    collection:
        | "app_article_likes"
        | "app_article_comments"
        | "app_diary_likes"
        | "app_diary_comments",
    relationField: "article_id" | "diary_id",
    relationIds: string[],
    options?: {
        requirePublic?: boolean;
    },
): Promise<Map<string, number>> {
    if (relationIds.length === 0) {
        return new Map();
    }

    const andFilters: JsonObject[] = [
        { [relationField]: { _in: relationIds } } as JsonObject,
        { status: { _eq: "published" } },
    ];
    if (options?.requirePublic) {
        andFilters.push({ is_public: { _eq: true } });
    }

    return await countItemsGroupedByField(collection, relationField, {
        _and: andFilters,
    } as JsonObject);
}

function compareSortableHomeFeedItems(
    left: SortableHomeFeedItem,
    right: SortableHomeFeedItem,
): number {
    const publishedDiff =
        right.publishedAt.getTime() - left.publishedAt.getTime();
    if (publishedDiff !== 0) {
        return publishedDiff;
    }

    const createdDiff =
        right.sortCreatedAt.getTime() - left.sortCreatedAt.getTime();
    if (createdDiff !== 0) {
        return createdDiff;
    }

    const leftKey = `${left.type}:${left.id}`;
    const rightKey = `${right.type}:${right.id}`;
    return leftKey.localeCompare(rightKey);
}

async function loadArticleItems(
    limit: number,
): Promise<SortableHomeFeedItem[]> {
    const articleFilters: JsonObject[] = [
        { status: { _eq: "published" } },
        { is_public: { _eq: true } },
        excludeSpecialArticleSlugFilter(),
    ];
    const articleRows = await readMany("app_articles", {
        filter: { _and: articleFilters } as JsonObject,
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
        sort: ["-date_updated", "-date_created"],
        limit,
    });

    const articleIds = Array.from(
        new Set(
            articleRows.map((row) => normalizeIdentity(row.id)).filter(Boolean),
        ),
    );
    const authorIds = Array.from(
        new Set(
            articleRows
                .map((row) => normalizeIdentity(row.author_id))
                .filter(Boolean),
        ),
    );
    const [authorMap, articleLikeCountMap, articleCommentCountMap] =
        await Promise.all([
            getAuthorBundle(authorIds),
            fetchInteractionCountMap(
                "app_article_likes",
                "article_id",
                articleIds,
            ),
            fetchInteractionCountMap(
                "app_article_comments",
                "article_id",
                articleIds,
                {
                    requirePublic: true,
                },
            ),
        ]);

    const items: SortableHomeFeedItem[] = [];

    for (const row of articleRows) {
        const entry = buildArticleFeedEntry(
            row,
            authorMap,
            articleLikeCountMap,
            articleCommentCountMap,
        );
        if (!entry) {
            continue;
        }

        const item: HomeFeedArticleItem = {
            type: "article",
            id: normalizeIdentity(entry.data.article_id),
            authorId: normalizeIdentity(entry.data.author_id),
            publishedAt: toSafeDate(entry.data.updated || entry.data.published),
            entry,
        };
        if (!item.id || !item.authorId) {
            continue;
        }

        items.push({
            ...item,
            sortCreatedAt: toSafeDate(row.date_created),
        });
    }

    return items;
}

async function loadDiaryItems(limit: number): Promise<SortableHomeFeedItem[]> {
    const diaryRows = await readMany("app_diaries", {
        filter: {
            _and: [
                { status: { _eq: "published" } },
                { praviate: { _eq: true } },
            ],
        } as JsonObject,
        fields: [...DIARY_FIELDS],
        sort: ["-date_updated", "-date_created"],
        limit,
    });

    const diaryIds = Array.from(
        new Set(
            diaryRows.map((row) => normalizeIdentity(row.id)).filter(Boolean),
        ),
    );
    const authorIds = Array.from(
        new Set(
            diaryRows
                .map((row) => normalizeIdentity(row.author_id))
                .filter(Boolean),
        ),
    );
    const [authorMap, diaryImages, diaryLikeCountMap, diaryCommentCountMap] =
        await Promise.all([
            getAuthorBundle(authorIds),
            diaryIds.length > 0
                ? readMany("app_diary_images", {
                      filter: {
                          _and: [
                              { diary_id: { _in: diaryIds } },
                              { status: { _eq: "published" } },
                              { is_public: { _eq: true } },
                          ],
                      } as JsonObject,
                      sort: ["sort", "-date_created"],
                      limit: -1,
                  })
                : Promise.resolve([] as AppDiaryImage[]),
            fetchInteractionCountMap("app_diary_likes", "diary_id", diaryIds),
            fetchInteractionCountMap(
                "app_diary_comments",
                "diary_id",
                diaryIds,
                {
                    requirePublic: true,
                },
            ),
        ]);

    const diaryImageMap = buildDiaryImageMap(diaryImages);
    const items: SortableHomeFeedItem[] = [];

    for (const row of diaryRows) {
        const diaryId = normalizeIdentity(row.id);
        const authorId = normalizeIdentity(row.author_id);
        if (!diaryId || !authorId) {
            continue;
        }

        const entry: HomeFeedDiaryEntry = {
            ...row,
            author: authorMap.get(authorId) || {
                id: authorId,
                name: authorId,
                username: authorId,
                display_name: authorId,
            },
            images: diaryImageMap.get(diaryId) || [],
            comment_count: diaryCommentCountMap.get(diaryId) || 0,
            like_count: diaryLikeCountMap.get(diaryId) || 0,
        };

        const item: HomeFeedDiaryItem = {
            type: "diary",
            id: diaryId,
            authorId,
            publishedAt: toSafeDate(row.date_updated || row.date_created),
            entry,
        };

        items.push({
            ...item,
            sortCreatedAt: toSafeDate(row.date_created),
        });
    }

    return items;
}

async function buildMixedHomeFeed(limit: number): Promise<HomeFeedItem[]> {
    const [articleItems, diaryItems] = await Promise.all([
        loadArticleItems(limit),
        loadDiaryItems(limit),
    ]);

    // 首页只保留最近修改时间的统一排序，避免额外推荐打分与混排成本。
    return [...articleItems, ...diaryItems]
        .sort(compareSortableHomeFeedItems)
        .slice(0, limit)
        .map(({ sortCreatedAt: _, ...item }) => item);
}

const buildHomeFeedSingleFlight = createSingleFlightRunner(
    async (
        cacheKey: string,
        params: {
            limit: number;
            now: Date;
        },
    ): Promise<HomeFeedBuildResult> => {
        const result: HomeFeedBuildResult = {
            items: await buildMixedHomeFeed(params.limit),
            generatedAt: params.now.toISOString(),
        };

        void cacheManager.set("home-feed", cacheKey, result);
        return result;
    },
    (cacheKey: string) => cacheKey,
);

export async function buildHomeFeed(
    options: HomeFeedBuildOptions = {},
): Promise<HomeFeedBuildResult> {
    return await runWithDirectusServiceAccess(async () => {
        const limit = normalizePositiveInt(
            options.limit,
            DEFAULT_OUTPUT_LIMIT,
            DEFAULT_OUTPUT_LIMIT,
        );
        const now = options.now ? toSafeDate(options.now) : new Date();

        const cacheKey = hashParams({
            limit,
        });
        const cached = await cacheManager.get<HomeFeedBuildResult>(
            "home-feed",
            cacheKey,
        );
        if (cached) {
            return hydrateHomeFeedResult(cached);
        }

        return await buildHomeFeedSingleFlight(cacheKey, {
            limit,
            now,
        });
    });
}
