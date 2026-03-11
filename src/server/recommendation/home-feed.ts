import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import { permalinkConfig } from "@/config";
import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import { readMany } from "@/server/directus/client";
import { createSingleFlightRunner } from "@/server/utils/single-flight";
import type { JsonObject } from "@/types/json";
import { initPostIdMap } from "@/utils/permalink-utils";
import { excludeSpecialArticleSlugFilter } from "@/server/api/v1/shared";
import type {
    HomeFeedArticleCandidate,
    HomeFeedBuildOptions,
    HomeFeedBuildResult,
    HomeFeedCandidate,
    HomeFeedItem,
    HomeFeedItemType,
    HomeFeedScoredCandidate,
} from "./home-feed.types";
import {
    applyPreferenceProfileToCandidates,
    buildArticleFeedEntry,
    clamp01,
    createEmptyPreferenceProfile,
    normalizeIdentity,
    normalizePositiveInt,
    resolveArticlePublishedAt,
    toSafeDate,
} from "./home-feed-helpers";
import {
    calculateEngagementRaw,
    calculateFinalScore,
    calculateRecencyScore,
    normalizeMinMax,
} from "./home-feed-scoring";
import {
    hydrateHomeFeedResult,
    loadHomeFeedCandidatePool,
    loadPreferenceProfile,
    pickCandidateByType,
} from "./home-feed-pool";

export {
    calculateArticleQualityScore,
    calculateDiaryQualityScore,
    calculateEngagementRaw,
    calculateFinalScore,
    calculateRecencyScore,
    normalizeMinMax,
} from "./home-feed-scoring";

const DEFAULT_ARTICLE_CANDIDATE_LIMIT = 80;
const DEFAULT_DIARY_CANDIDATE_LIMIT = 60;
const DEFAULT_OUTPUT_LIMIT = 60;
const DEFAULT_ENGAGEMENT_WINDOW_HOURS = 72;
const DEFAULT_PERSONALIZATION_LOOKBACK_DAYS = 30;

const MAX_TYPE_STREAK = 3;
const AUTHOR_COOLDOWN_WINDOW = 2;
const MIX_PATTERN: HomeFeedItemType[] = [
    "article",
    "article",
    "diary",
    "article",
    "diary",
];

export const HOME_FEED_ALGO_VERSION = "home-feed-v2";

const HOME_FEED_OWNER_DRAFT_FIELDS = [
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

let permalinkMapInitialized = false;

const buildHomeFeedSingleFlight = createSingleFlightRunner(
    async (
        cacheKey: string,
        params: {
            viewerId: string | null;
            limit: number;
            outputLimit: number;
            articleCandidateLimit: number;
            diaryCandidateLimit: number;
            engagementWindowHours: number;
            personalizationLookbackDays: number;
            algoVersion: string;
            now: Date;
        },
    ): Promise<HomeFeedBuildResult> => {
        const [candidatePool, preferenceProfile] = await Promise.all([
            loadHomeFeedCandidatePool({
                articleCandidateLimit: params.articleCandidateLimit,
                diaryCandidateLimit: params.diaryCandidateLimit,
                engagementWindowHours: params.engagementWindowHours,
                algoVersion: params.algoVersion,
                now: params.now,
            }),
            params.viewerId
                ? loadPreferenceProfile(
                      params.viewerId,
                      params.now,
                      params.personalizationLookbackDays,
                  )
                : Promise.resolve(createEmptyPreferenceProfile()),
        ]);

        const isLoggedIn = Boolean(params.viewerId);
        const finalCandidates = params.viewerId
            ? applyPreferenceProfileToCandidates(
                  candidatePool.candidates,
                  preferenceProfile,
              )
            : candidatePool.candidates;
        const scoredCandidates = scoreHomeFeedCandidates(finalCandidates, {
            now: params.now,
            isLoggedIn,
        });
        const mixedItems = mixHomeFeedCandidates(
            scoredCandidates,
            params.limit,
        );
        const ownerDraft = params.viewerId
            ? await loadOwnerWorkingDraftCandidate(params.viewerId)
            : null;
        const items = prependOwnerDraftToHomeFeed(
            mixedItems,
            ownerDraft,
            params.limit,
        );

        const result: HomeFeedBuildResult = {
            items,
            generatedAt: params.now.toISOString(),
            meta: {
                viewerId: params.viewerId,
                limit: params.limit,
                outputLimit: params.outputLimit,
                articleCandidateLimit: params.articleCandidateLimit,
                diaryCandidateLimit: params.diaryCandidateLimit,
                articleCandidateCount: candidatePool.articleCandidateCount,
                diaryCandidateCount: candidatePool.diaryCandidateCount,
                engagementWindowHours: params.engagementWindowHours,
                personalizationLookbackDays: params.personalizationLookbackDays,
                algoVersion: params.algoVersion,
            },
        };

        void cacheManager.set("home-feed", cacheKey, result);
        return result;
    },
    (cacheKey: string) => cacheKey,
);

async function ensurePermalinkPostIdMapInitialized(): Promise<void> {
    if (!permalinkConfig.enable || permalinkMapInitialized) {
        return;
    }

    const articleFilters: JsonObject[] = [
        { status: { _eq: "published" } },
        { is_public: { _eq: true } },
        excludeSpecialArticleSlugFilter(),
    ];

    const rows = await readMany("app_articles", {
        filter: { _and: articleFilters } as JsonObject,
        fields: ["id", "short_id", "date_updated", "date_created"],
        sort: ["-date_updated", "-date_created"],
        limit: 1000,
    });

    const permalinkPosts = rows
        .map((row) => ({
            id: normalizeIdentity(row.short_id) || normalizeIdentity(row.id),
            data: {
                published: resolveArticlePublishedAt(row),
                created: toSafeDate(row.date_created),
            },
        }))
        .filter((post) => Boolean(post.id));
    initPostIdMap(permalinkPosts);
    permalinkMapInitialized = true;
}

async function loadOwnerWorkingDraftCandidate(
    viewerId: string,
): Promise<HomeFeedArticleCandidate | null> {
    const normalizedViewerId = normalizeIdentity(viewerId);
    if (!normalizedViewerId) {
        return null;
    }

    const rows = await readMany("app_articles", {
        filter: {
            _and: [
                { author_id: { _eq: normalizedViewerId } },
                { status: { _eq: "draft" } },
                excludeSpecialArticleSlugFilter(),
            ],
        } as JsonObject,
        fields: [...HOME_FEED_OWNER_DRAFT_FIELDS],
        sort: ["-date_updated", "-date_created"],
        limit: 1,
    });
    const article = rows[0];
    if (!article) {
        return null;
    }

    const authorMap = await getAuthorBundle([normalizedViewerId]);
    const entry = buildArticleFeedEntry(
        article,
        authorMap,
        new Map(),
        new Map(),
        { forceAuthenticatedCover: true },
    );
    if (!entry) {
        return null;
    }

    return {
        type: "article",
        id: normalizeIdentity(article.id),
        authorId: normalizeIdentity(article.author_id),
        publishedAt: resolveArticlePublishedAt(article),
        entry,
        likes72h: 0,
        comments72h: 0,
        qualityScore: 0,
        personalizationScore: 0,
    };
}

export function prependOwnerDraftToHomeFeed(
    items: HomeFeedItem[],
    ownerDraft: HomeFeedArticleCandidate | null,
    limit: number,
): HomeFeedItem[] {
    if (!ownerDraft || limit <= 0) {
        return items.slice(0, limit);
    }
    const ownerDraftItem: HomeFeedItem = {
        ...ownerDraft,
        score: Number.MAX_SAFE_INTEGER,
        signals: {
            recency: 0,
            engagement: 0,
            quality: 0,
            personalization: 0,
            engagementRaw: 0,
            likes72h: 0,
            comments72h: 0,
        },
    };
    return [
        ownerDraftItem,
        ...items.filter((item) => item.id !== ownerDraft.id),
    ].slice(0, limit);
}

export function scoreHomeFeedCandidates(
    candidates: HomeFeedCandidate[],
    options: { now: Date; isLoggedIn: boolean },
): HomeFeedScoredCandidate[] {
    if (candidates.length === 0) {
        return [];
    }

    const engagementRawScores = candidates.map((candidate) =>
        calculateEngagementRaw(candidate.likes72h, candidate.comments72h),
    );
    const normalizedEngagement = normalizeMinMax(engagementRawScores);

    const scored = candidates.map((candidate, index) => {
        const hoursSincePublish = Math.max(
            0,
            (options.now.getTime() - candidate.publishedAt.getTime()) /
                (60 * 60 * 1000),
        );
        const recency = calculateRecencyScore(hoursSincePublish);
        const engagement = normalizedEngagement[index] || 0;
        const quality = clamp01(candidate.qualityScore);
        const personalization = options.isLoggedIn
            ? clamp01(candidate.personalizationScore)
            : 0;
        const score = calculateFinalScore({
            recency,
            engagement,
            quality,
            personalization,
            isLoggedIn: options.isLoggedIn,
        });

        return {
            ...candidate,
            score,
            signals: {
                recency,
                engagement,
                quality,
                personalization,
                engagementRaw: engagementRawScores[index] || 0,
                likes72h: candidate.likes72h,
                comments72h: candidate.comments72h,
            },
        } satisfies HomeFeedScoredCandidate;
    });

    return scored.sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        return right.publishedAt.getTime() - left.publishedAt.getTime();
    });
}

export function mixHomeFeedCandidates(
    candidates: HomeFeedScoredCandidate[],
    limit: number,
): HomeFeedItem[] {
    if (candidates.length === 0 || limit <= 0) {
        return [];
    }

    const sorted = [...candidates].sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        return right.publishedAt.getTime() - left.publishedAt.getTime();
    });
    const articleQueue = sorted.filter(
        (candidate) => candidate.type === "article",
    );
    const diaryQueue = sorted.filter((candidate) => candidate.type === "diary");

    const output: HomeFeedItem[] = [];
    const recentAuthors: string[] = [];
    const recentTypes: HomeFeedItemType[] = [];

    let patternIndex = 0;
    while (
        output.length < limit &&
        (articleQueue.length > 0 || diaryQueue.length > 0)
    ) {
        const expectedType = MIX_PATTERN[patternIndex % MIX_PATTERN.length];
        patternIndex += 1;

        const selected = pickCandidateByType(
            articleQueue,
            diaryQueue,
            expectedType,
            recentAuthors,
            recentTypes,
        );
        if (!selected) {
            break;
        }

        output.push(selected);
        recentAuthors.push(selected.authorId);
        recentTypes.push(selected.type);

        if (recentAuthors.length > AUTHOR_COOLDOWN_WINDOW) {
            recentAuthors.shift();
        }
        if (recentTypes.length > MAX_TYPE_STREAK) {
            recentTypes.shift();
        }
    }

    return output;
}

export async function buildHomeFeed(
    options: HomeFeedBuildOptions = {},
): Promise<HomeFeedBuildResult> {
    const viewerId = normalizeIdentity(options.viewerId || "") || null;
    const outputLimit = normalizePositiveInt(
        options.outputLimit,
        DEFAULT_OUTPUT_LIMIT,
        DEFAULT_OUTPUT_LIMIT,
    );
    const limit = normalizePositiveInt(options.limit, outputLimit, outputLimit);
    const articleCandidateLimit = normalizePositiveInt(
        options.articleCandidateLimit,
        DEFAULT_ARTICLE_CANDIDATE_LIMIT,
        DEFAULT_ARTICLE_CANDIDATE_LIMIT,
    );
    const diaryCandidateLimit = normalizePositiveInt(
        options.diaryCandidateLimit,
        DEFAULT_DIARY_CANDIDATE_LIMIT,
        DEFAULT_DIARY_CANDIDATE_LIMIT,
    );
    const engagementWindowHours = normalizePositiveInt(
        options.engagementWindowHours,
        DEFAULT_ENGAGEMENT_WINDOW_HOURS,
        24 * 14,
    );
    const personalizationLookbackDays = normalizePositiveInt(
        options.personalizationLookbackDays,
        DEFAULT_PERSONALIZATION_LOOKBACK_DAYS,
        365,
    );
    const algoVersion =
        normalizeIdentity(options.algoVersion) || HOME_FEED_ALGO_VERSION;
    const now = options.now ? toSafeDate(options.now) : new Date();
    await ensurePermalinkPostIdMapInitialized();

    const cacheKey = hashParams({
        viewerId: viewerId || "guest",
        limit,
        outputLimit,
        articleCandidateLimit,
        diaryCandidateLimit,
        engagementWindowHours,
        personalizationLookbackDays,
        algoVersion,
    });
    const cached = await cacheManager.get<HomeFeedBuildResult>(
        "home-feed",
        cacheKey,
    );
    if (cached) {
        return hydrateHomeFeedResult(cached);
    }

    return await buildHomeFeedSingleFlight(cacheKey, {
        viewerId,
        limit,
        outputLimit,
        articleCandidateLimit,
        diaryCandidateLimit,
        engagementWindowHours,
        personalizationLookbackDays,
        algoVersion,
        now,
    });
}
