import {
    DIARY_FIELDS,
    excludeSpecialArticleSlugFilter,
} from "@/server/api/v1/shared";
import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import { readMany } from "@/server/directus/client";
import { createSingleFlightRunner } from "@/server/utils/single-flight";
import type { JsonObject } from "@/types/json";
import type { AppArticle, AppDiary, AppDiaryImage } from "@/types/app";
import type { DirectusPostEntry } from "@/utils/content-utils";
import type {
    HomeFeedArticleCandidate,
    HomeFeedBuildResult,
    HomeFeedCandidate,
    HomeFeedDiaryCandidate,
    HomeFeedDiaryEntry,
    HomeFeedItemType,
    HomeFeedPreferenceProfile,
    HomeFeedScoredCandidate,
} from "./home-feed.types";
import {
    buildArticleFeedEntry,
    buildDiaryImageMap,
    createEmptyPreferenceProfile,
    fetchInteractionCountMap,
    hydrateHomeFeedCandidate,
    hydrateHomeFeedItem,
    hydratePreferenceProfile,
    incrementMapCounter,
    normalizeIdentity,
    normalizePreferenceKey,
    normalizeWeightMap,
    readAuthorFromMap,
    serializePreferenceProfile,
    toSafeDate,
} from "./home-feed-helpers";
import type { HomeFeedPreferenceProfileCachePayload } from "./home-feed-helpers";
import {
    calculateArticleQualityScore,
    calculateDiaryQualityScore,
} from "./home-feed-scoring";

export type HomeFeedCandidatePoolCachePayload = {
    generatedAt: string;
    articleCandidateCount: number;
    diaryCandidateCount: number;
    candidates: HomeFeedCandidate[];
};

type PickConstraint = {
    enforceAuthorCooldown: boolean;
    enforceTypeStreak: boolean;
};

const AUTHOR_COOLDOWN_WINDOW = 2;
const MAX_TYPE_STREAK = 3;

const PICK_CONSTRAINTS: PickConstraint[] = [
    { enforceAuthorCooldown: true, enforceTypeStreak: true },
    { enforceAuthorCooldown: false, enforceTypeStreak: true },
    { enforceAuthorCooldown: false, enforceTypeStreak: false },
];

const HOME_FEED_CANDIDATE_CACHE_VERSION = "home-feed-candidates-v2";
const HOME_FEED_PROFILE_CACHE_VERSION = "home-feed-profile-v1";

const ARTICLE_FEED_FIELDS = [
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
] as const;

export function hydrateHomeFeedCandidatePool(
    payload: HomeFeedCandidatePoolCachePayload,
): HomeFeedCandidatePoolCachePayload {
    return {
        ...payload,
        candidates: payload.candidates.map((candidate) =>
            hydrateHomeFeedCandidate(candidate),
        ),
    };
}

export function hydrateHomeFeedResult(
    result: HomeFeedBuildResult,
): HomeFeedBuildResult {
    return {
        ...result,
        items: result.items.map((item) => hydrateHomeFeedItem(item)),
    };
}

function violatesAuthorCooldown(
    candidate: HomeFeedScoredCandidate,
    recentAuthors: string[],
): boolean {
    if (AUTHOR_COOLDOWN_WINDOW <= 0 || recentAuthors.length === 0) {
        return false;
    }
    return recentAuthors
        .slice(-AUTHOR_COOLDOWN_WINDOW)
        .includes(candidate.authorId);
}

function violatesTypeStreak(
    candidate: HomeFeedScoredCandidate,
    recentTypes: HomeFeedItemType[],
): boolean {
    if (MAX_TYPE_STREAK <= 0 || recentTypes.length < MAX_TYPE_STREAK) {
        return false;
    }
    for (let index = 1; index <= MAX_TYPE_STREAK; index += 1) {
        if (recentTypes[recentTypes.length - index] !== candidate.type) {
            return false;
        }
    }
    return true;
}

function takeCandidateFromQueue(
    queue: HomeFeedScoredCandidate[],
    recentAuthors: string[],
    recentTypes: HomeFeedItemType[],
    constraint: PickConstraint,
): HomeFeedScoredCandidate | null {
    for (let index = 0; index < queue.length; index += 1) {
        const candidate = queue[index];
        if (
            constraint.enforceAuthorCooldown &&
            violatesAuthorCooldown(candidate, recentAuthors)
        ) {
            continue;
        }
        if (
            constraint.enforceTypeStreak &&
            violatesTypeStreak(candidate, recentTypes)
        ) {
            continue;
        }
        queue.splice(index, 1);
        return candidate;
    }
    return null;
}

export function pickCandidateByType(
    articleQueue: HomeFeedScoredCandidate[],
    diaryQueue: HomeFeedScoredCandidate[],
    expectedType: HomeFeedItemType,
    recentAuthors: string[],
    recentTypes: HomeFeedItemType[],
): HomeFeedScoredCandidate | null {
    const primaryQueue = expectedType === "article" ? articleQueue : diaryQueue;
    const secondaryQueue =
        expectedType === "article" ? diaryQueue : articleQueue;

    for (const constraint of PICK_CONSTRAINTS) {
        const preferred = takeCandidateFromQueue(
            primaryQueue,
            recentAuthors,
            recentTypes,
            constraint,
        );
        if (preferred) {
            return preferred;
        }
        const fallback = takeCandidateFromQueue(
            secondaryQueue,
            recentAuthors,
            recentTypes,
            constraint,
        );
        if (fallback) {
            return fallback;
        }
    }

    return null;
}

export async function loadPreferenceProfile(
    viewerId: string,
    now: Date,
    lookbackDays: number,
): Promise<HomeFeedPreferenceProfile> {
    const normalizedViewerId = normalizeIdentity(viewerId);
    if (!normalizedViewerId) {
        return createEmptyPreferenceProfile();
    }
    const cacheKey = hashParams({
        cacheVersion: HOME_FEED_PROFILE_CACHE_VERSION,
        viewerId: normalizedViewerId,
        lookbackDays,
    });
    const cached =
        await cacheManager.get<HomeFeedPreferenceProfileCachePayload>(
            "home-feed-profile",
            cacheKey,
        );
    if (cached) {
        return hydratePreferenceProfile(cached);
    }

    return await loadPreferenceProfileSingleFlight(
        cacheKey,
        normalizedViewerId,
        now,
        lookbackDays,
    );
}

const loadPreferenceProfileSingleFlight = createSingleFlightRunner(
    async (
        cacheKey: string,
        normalizedViewerId: string,
        now: Date,
        lookbackDays: number,
    ): Promise<HomeFeedPreferenceProfile> => {
        const lookbackStartIso = new Date(
            now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
        ).toISOString();

        const [articleLikes, diaryLikes] = await Promise.all([
            readMany("app_article_likes", {
                filter: {
                    _and: [
                        { user_id: { _eq: normalizedViewerId } },
                        { status: { _eq: "published" } },
                        { date_created: { _gte: lookbackStartIso } },
                    ],
                } as JsonObject,
                fields: ["article_id"],
                limit: -1,
            }),
            readMany("app_diary_likes", {
                filter: {
                    _and: [
                        { user_id: { _eq: normalizedViewerId } },
                        { status: { _eq: "published" } },
                        { date_created: { _gte: lookbackStartIso } },
                    ],
                } as JsonObject,
                fields: ["diary_id"],
                limit: -1,
            }),
        ]);

        const articleIds = Array.from(
            new Set(
                (articleLikes as Array<Record<string, unknown>>)
                    .map((like) =>
                        normalizeIdentity(String(like.article_id || "")),
                    )
                    .filter(Boolean),
            ),
        );
        const diaryIds = Array.from(
            new Set(
                (diaryLikes as Array<Record<string, unknown>>)
                    .map((like) =>
                        normalizeIdentity(String(like.diary_id || "")),
                    )
                    .filter(Boolean),
            ),
        );

        const [likedArticles, likedDiaries] = await Promise.all([
            articleIds.length > 0
                ? readMany("app_articles", {
                      filter: { id: { _in: articleIds } } as JsonObject,
                      fields: ["id", "author_id", "tags", "category"],
                      limit: Math.max(articleIds.length, 20),
                  })
                : Promise.resolve([] as AppArticle[]),
            diaryIds.length > 0
                ? readMany("app_diaries", {
                      filter: { id: { _in: diaryIds } } as JsonObject,
                      fields: ["id", "author_id"],
                      limit: Math.max(diaryIds.length, 20),
                  })
                : Promise.resolve([] as AppDiary[]),
        ]);

        const authorCounts = new Map<string, number>();
        const tagCounts = new Map<string, number>();
        const categoryCounts = new Map<string, number>();

        for (const article of likedArticles) {
            incrementMapCounter(authorCounts, article.author_id);
            for (const tag of article.tags ?? []) {
                incrementMapCounter(tagCounts, normalizePreferenceKey(tag));
            }
            const category = normalizePreferenceKey(article.category);
            if (category) {
                incrementMapCounter(categoryCounts, category);
            }
        }

        for (const diary of likedDiaries) {
            incrementMapCounter(authorCounts, diary.author_id);
        }

        const profile = {
            authorWeights: normalizeWeightMap(authorCounts),
            tagWeights: normalizeWeightMap(tagCounts),
            categoryWeights: normalizeWeightMap(categoryCounts),
        } satisfies HomeFeedPreferenceProfile;
        void cacheManager.set(
            "home-feed-profile",
            cacheKey,
            serializePreferenceProfile(profile),
        );
        return profile;
    },
    (cacheKey: string) => cacheKey,
);

export async function buildHomeFeedCandidatePool(options: {
    articleCandidateLimit: number;
    diaryCandidateLimit: number;
    engagementWindowHours: number;
    now: Date;
}): Promise<HomeFeedCandidatePoolCachePayload> {
    const articleFilters: JsonObject[] = [
        { status: { _eq: "published" } },
        { is_public: { _eq: true } },
        excludeSpecialArticleSlugFilter(),
    ];

    const [articleRows, diaryRows] = await Promise.all([
        readMany("app_articles", {
            filter: { _and: articleFilters } as JsonObject,
            fields: [...ARTICLE_FEED_FIELDS],
            sort: ["-date_updated", "-date_created"],
            limit: options.articleCandidateLimit,
        }),
        readMany("app_diaries", {
            filter: {
                _and: [
                    { status: { _eq: "published" } },
                    { praviate: { _eq: true } },
                ],
            } as JsonObject,
            fields: [...DIARY_FIELDS],
            sort: ["-date_created"],
            limit: options.diaryCandidateLimit,
        }),
    ]);

    const articleIds = Array.from(
        new Set(
            articleRows.map((row) => normalizeIdentity(row.id)).filter(Boolean),
        ),
    );
    const diaryIds = Array.from(
        new Set(
            diaryRows.map((row) => normalizeIdentity(row.id)).filter(Boolean),
        ),
    );
    const articleAuthorIds = Array.from(
        new Set(
            articleRows
                .map((row) => normalizeIdentity(row.author_id))
                .filter(Boolean),
        ),
    );
    const diaryAuthorIds = Array.from(
        new Set(
            diaryRows
                .map((row) => normalizeIdentity(row.author_id))
                .filter(Boolean),
        ),
    );
    const windowStartIso = new Date(
        options.now.getTime() - options.engagementWindowHours * 60 * 60 * 1000,
    ).toISOString();

    const allAuthorIds = Array.from(
        new Set([...articleAuthorIds, ...diaryAuthorIds].filter(Boolean)),
    );

    const [
        authorMap,
        articleLikeCountMap,
        articleCommentCountMap,
        articleLike72hMap,
        articleComment72hMap,
        diaryImages,
        diaryLikeCountMap,
        diaryCommentCountMap,
        diaryLike72hMap,
        diaryComment72hMap,
    ] = await Promise.all([
        getAuthorBundle(allAuthorIds),
        fetchInteractionCountMap("app_article_likes", "article_id", articleIds),
        fetchInteractionCountMap(
            "app_article_comments",
            "article_id",
            articleIds,
            { requirePublic: true },
        ),
        fetchInteractionCountMap(
            "app_article_likes",
            "article_id",
            articleIds,
            { windowStartIso },
        ),
        fetchInteractionCountMap(
            "app_article_comments",
            "article_id",
            articleIds,
            { requirePublic: true, windowStartIso },
        ),
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
        fetchInteractionCountMap("app_diary_comments", "diary_id", diaryIds, {
            requirePublic: true,
        }),
        fetchInteractionCountMap("app_diary_likes", "diary_id", diaryIds, {
            windowStartIso,
        }),
        fetchInteractionCountMap("app_diary_comments", "diary_id", diaryIds, {
            requirePublic: true,
            windowStartIso,
        }),
    ]);

    const articleEntries = articleRows
        .map((row) =>
            buildArticleFeedEntry(
                row,
                authorMap,
                articleLikeCountMap,
                articleCommentCountMap,
            ),
        )
        .filter((entry): entry is DirectusPostEntry => entry !== null);

    const articleCandidates: HomeFeedArticleCandidate[] = articleEntries.map(
        (entry) => ({
            type: "article",
            id: normalizeIdentity(entry.data.article_id),
            authorId: normalizeIdentity(entry.data.author_id),
            publishedAt: toSafeDate(entry.data.published),
            entry,
            likes72h: articleLike72hMap.get(entry.data.article_id) || 0,
            comments72h: articleComment72hMap.get(entry.data.article_id) || 0,
            qualityScore: calculateArticleQualityScore(entry),
            personalizationScore: 0,
        }),
    );

    const diaryImageMap = buildDiaryImageMap(diaryImages);
    const diaryEntries: HomeFeedDiaryEntry[] = diaryRows.map((row) => ({
        ...row,
        author: readAuthorFromMap(authorMap, row.author_id),
        images: diaryImageMap.get(row.id) || [],
        comment_count: diaryCommentCountMap.get(row.id) || 0,
        like_count: diaryLikeCountMap.get(row.id) || 0,
    }));

    const diaryCandidates: HomeFeedDiaryCandidate[] = diaryEntries
        .map((entry) => {
            const diaryId = normalizeIdentity(entry.id);
            const authorId = normalizeIdentity(entry.author_id);
            if (!diaryId || !authorId) {
                return null;
            }
            return {
                type: "diary",
                id: diaryId,
                authorId,
                publishedAt: toSafeDate(
                    entry.date_created || entry.date_updated,
                ),
                entry,
                likes72h: diaryLike72hMap.get(entry.id) || 0,
                comments72h: diaryComment72hMap.get(entry.id) || 0,
                qualityScore: calculateDiaryQualityScore(entry),
                personalizationScore: 0,
            };
        })
        .filter(
            (candidate): candidate is HomeFeedDiaryCandidate =>
                candidate !== null,
        );

    return {
        generatedAt: options.now.toISOString(),
        articleCandidateCount: articleCandidates.length,
        diaryCandidateCount: diaryCandidates.length,
        candidates: [...articleCandidates, ...diaryCandidates],
    };
}

export async function loadHomeFeedCandidatePool(options: {
    articleCandidateLimit: number;
    diaryCandidateLimit: number;
    engagementWindowHours: number;
    algoVersion: string;
    now: Date;
}): Promise<HomeFeedCandidatePoolCachePayload> {
    const candidateCacheKey = hashParams({
        algoVersion: options.algoVersion,
        cacheVersion: HOME_FEED_CANDIDATE_CACHE_VERSION,
        articleCandidateLimit: options.articleCandidateLimit,
        diaryCandidateLimit: options.diaryCandidateLimit,
        engagementWindowHours: options.engagementWindowHours,
    });
    const cached = await cacheManager.get<HomeFeedCandidatePoolCachePayload>(
        "home-feed-candidates",
        candidateCacheKey,
    );
    if (cached) {
        return hydrateHomeFeedCandidatePool(cached);
    }

    return await loadHomeFeedCandidatePoolSingleFlight(candidateCacheKey, {
        articleCandidateLimit: options.articleCandidateLimit,
        diaryCandidateLimit: options.diaryCandidateLimit,
        engagementWindowHours: options.engagementWindowHours,
        now: options.now,
    });
}

const loadHomeFeedCandidatePoolSingleFlight = createSingleFlightRunner(
    async (
        cacheKey: string,
        options: {
            articleCandidateLimit: number;
            diaryCandidateLimit: number;
            engagementWindowHours: number;
            now: Date;
        },
    ): Promise<HomeFeedCandidatePoolCachePayload> => {
        const payload = await buildHomeFeedCandidatePool(options);
        void cacheManager.set("home-feed-candidates", cacheKey, payload);
        return payload;
    },
    (cacheKey: string) => cacheKey,
);
