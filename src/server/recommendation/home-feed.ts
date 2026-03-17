import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import {
    DIARY_FIELDS,
    excludeSpecialArticleSlugFilter,
    safeCsv,
} from "@/server/api/v1/shared";
import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import { readMany } from "@/server/directus/client";
import { buildPublicAssetUrl } from "@/server/directus-auth";
import { permalinkConfig } from "@/config";
import type { JsonObject } from "@/types/json";
import type { AppArticle, AppDiary, AppDiaryImage } from "@/types/app";
import type { DirectusPostEntry } from "@/utils/content-utils";
import { initPostIdMap } from "@/utils/permalink-utils";
import type {
    HomeFeedArticleCandidate,
    HomeFeedBuildOptions,
    HomeFeedBuildResult,
    HomeFeedCandidate,
    HomeFeedDiaryCandidate,
    HomeFeedDiaryEntry,
    HomeFeedItem,
    HomeFeedItemType,
    HomeFeedPreferenceProfile,
    HomeFeedScoreInput,
    HomeFeedScoredCandidate,
} from "./home-feed.types";

const DEFAULT_ARTICLE_CANDIDATE_LIMIT = 80;
const DEFAULT_DIARY_CANDIDATE_LIMIT = 60;
const DEFAULT_OUTPUT_LIMIT = 60;
const DEFAULT_ENGAGEMENT_WINDOW_HOURS = 72;
const DEFAULT_PERSONALIZATION_LOOKBACK_DAYS = 30;

const AUTHOR_COOLDOWN_WINDOW = 2;
const MAX_TYPE_STREAK = 3;
const MIX_PATTERN: HomeFeedItemType[] = [
    "article",
    "article",
    "diary",
    "article",
    "diary",
];

const RECENCY_DECAY_HOURS = 36;

export const HOME_FEED_ALGO_VERSION = "home-feed-v1";

const HOME_FEED_CANDIDATE_CACHE_VERSION = "home-feed-candidates-v1";
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
    "published_at",
    "date_created",
    "date_updated",
] as const;

type HomeFeedCandidatePoolCachePayload = {
    generatedAt: string;
    articleCandidateCount: number;
    diaryCandidateCount: number;
    candidates: HomeFeedCandidate[];
};

type HomeFeedPreferenceProfileCachePayload = {
    authorWeights: Array<[string, number]>;
    tagWeights: Array<[string, number]>;
    categoryWeights: Array<[string, number]>;
};

let permalinkMapInitialized = false;

type InteractionCollection =
    | "app_article_likes"
    | "app_article_comments"
    | "app_diary_likes"
    | "app_diary_comments";

type InteractionRelationField = "article_id" | "diary_id";

type PickConstraint = {
    enforceAuthorCooldown: boolean;
    enforceTypeStreak: boolean;
};

type HomeFeedAuthor = {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
};

type HomeFeedAuthorMap = Map<string, HomeFeedAuthor>;

const PICK_CONSTRAINTS: PickConstraint[] = [
    { enforceAuthorCooldown: true, enforceTypeStreak: true },
    { enforceAuthorCooldown: false, enforceTypeStreak: true },
    { enforceAuthorCooldown: false, enforceTypeStreak: false },
];

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
}

function normalizeIdentity(value: string | null | undefined): string {
    return String(value || "").trim();
}

function normalizePreferenceKey(value: string | null | undefined): string {
    return String(value || "")
        .trim()
        .toLowerCase();
}

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

function toSafeDate(value: Date | string | null | undefined): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    const parsed = new Date(String(value || ""));
    if (Number.isNaN(parsed.getTime())) {
        return new Date(0);
    }
    return parsed;
}

function createEmptyPreferenceProfile(): HomeFeedPreferenceProfile {
    return {
        authorWeights: new Map(),
        tagWeights: new Map(),
        categoryWeights: new Map(),
    };
}

function serializePreferenceProfile(
    profile: HomeFeedPreferenceProfile,
): HomeFeedPreferenceProfileCachePayload {
    return {
        authorWeights: Array.from(profile.authorWeights.entries()),
        tagWeights: Array.from(profile.tagWeights.entries()),
        categoryWeights: Array.from(profile.categoryWeights.entries()),
    };
}

function hydratePreferenceProfile(
    payload: HomeFeedPreferenceProfileCachePayload,
): HomeFeedPreferenceProfile {
    return {
        authorWeights: new Map(payload.authorWeights),
        tagWeights: new Map(payload.tagWeights),
        categoryWeights: new Map(payload.categoryWeights),
    };
}

function incrementMapCounter(map: Map<string, number>, key: string): void {
    const normalizedKey = normalizeIdentity(key);
    if (!normalizedKey) {
        return;
    }
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + 1);
}

function normalizeWeightMap(source: Map<string, number>): Map<string, number> {
    if (source.size === 0) {
        return new Map();
    }
    const maxValue = Math.max(...source.values());
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
        return new Map();
    }
    const normalized = new Map<string, number>();
    for (const [key, value] of source.entries()) {
        normalized.set(key, clamp01(value / maxValue));
    }
    return normalized;
}

function buildCountMapByRelation(
    rows: Array<Record<string, unknown>>,
    relationField: InteractionRelationField,
): Map<string, number> {
    const counter = new Map<string, number>();
    for (const row of rows) {
        const relationId = normalizeIdentity(
            String(row[relationField] || "").trim(),
        );
        if (!relationId) {
            continue;
        }
        counter.set(relationId, (counter.get(relationId) || 0) + 1);
    }
    return counter;
}

async function fetchInteractionCountMap(
    collection: InteractionCollection,
    relationField: InteractionRelationField,
    relationIds: string[],
    options?: {
        requirePublic?: boolean;
        windowStartIso?: string;
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
    if (options?.windowStartIso) {
        andFilters.push({ date_created: { _gte: options.windowStartIso } });
    }

    const rows = await readMany(collection, {
        filter: { _and: andFilters } as JsonObject,
        fields: [relationField],
        limit: -1,
    });

    return buildCountMapByRelation(
        rows as Array<Record<string, unknown>>,
        relationField,
    );
}

function toFallbackAuthor(userId: string): {
    id: string;
    name: string;
    display_name: string;
    username: string;
} {
    const normalized = normalizeIdentity(userId);
    const shortId = (normalized || "user").slice(0, 8);
    const username = `user-${shortId}`;
    return {
        id: normalized,
        name: username,
        display_name: username,
        username,
    };
}

function readAuthorFromMap(
    authorMap: HomeFeedAuthorMap,
    userId: string,
): HomeFeedAuthor {
    const normalizedUserId = normalizeIdentity(userId);
    return (
        authorMap.get(normalizedUserId) || toFallbackAuthor(normalizedUserId)
    );
}

function stripTextLength(value: string | null | undefined): number {
    return String(value || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
}

function buildDiaryImageMap(
    images: AppDiaryImage[],
): Map<string, AppDiaryImage[]> {
    const map = new Map<string, AppDiaryImage[]>();
    for (const image of images) {
        const diaryId = normalizeIdentity(image.diary_id);
        if (!diaryId) {
            continue;
        }
        const list = map.get(diaryId) || [];
        list.push(image);
        map.set(diaryId, list);
    }
    return map;
}

function normalizeArticleTags(tags: AppArticle["tags"]): string[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function resolveArticlePublishedAt(article: AppArticle): Date {
    return toSafeDate(article.published_at || article.date_created);
}

function resolveArticleUpdatedAt(article: AppArticle): Date {
    return toSafeDate(article.date_updated || article.date_created);
}

async function ensurePermalinkPostIdMapInitialized(): Promise<void> {
    if (!permalinkConfig.enable || permalinkMapInitialized) {
        return;
    }

    const articleFilters: JsonObject[] = [
        { is_public: { _eq: true } },
        excludeSpecialArticleSlugFilter(),
    ];
    if (import.meta.env.PROD) {
        articleFilters.push({ status: { _eq: "published" } });
    }

    const rows = await readMany("app_articles", {
        filter: { _and: articleFilters } as JsonObject,
        fields: ["id", "short_id", "published_at", "date_created"],
        sort: ["-published_at", "-date_created"],
        limit: 1000,
    });

    const permalinkPosts = rows
        .map((row) => ({
            id: normalizeIdentity(row.short_id) || normalizeIdentity(row.id),
            data: {
                published: resolveArticlePublishedAt(row),
            },
        }))
        .filter((post) => Boolean(post.id));
    initPostIdMap(permalinkPosts);
    permalinkMapInitialized = true;
}

function resolveArticleTitle(article: AppArticle): string {
    const title = normalizeIdentity(article.title);
    if (title) {
        return title;
    }
    const slug = normalizeIdentity(article.slug);
    if (slug) {
        return slug;
    }
    return normalizeIdentity(article.id) || "Untitled";
}

function resolveArticleCover(article: AppArticle): string | undefined {
    const coverUrl = normalizeIdentity(article.cover_url);
    if (coverUrl) {
        return coverUrl;
    }
    const coverFile = normalizeIdentity(article.cover_file);
    if (!coverFile) {
        return undefined;
    }
    return buildPublicAssetUrl(coverFile, {
        width: 1200,
        height: 675,
        fit: "cover",
    });
}

function buildArticleFeedEntry(
    article: AppArticle,
    authorMap: HomeFeedAuthorMap,
    articleLikeCountMap: Map<string, number>,
    articleCommentCountMap: Map<string, number>,
): DirectusPostEntry | null {
    const articleId = normalizeIdentity(article.id);
    const authorId = normalizeIdentity(article.author_id);
    if (!articleId || !authorId) {
        return null;
    }

    const shortId = normalizeIdentity(article.short_id);
    const routeId = shortId || articleId;
    const publishedAt = resolveArticlePublishedAt(article);
    const updatedAt = resolveArticleUpdatedAt(article);

    return {
        id: routeId,
        slug: normalizeIdentity(article.slug) || null,
        // 首页卡片优先使用 summary，避免传输正文大字段。
        body: normalizeIdentity(article.summary),
        url: `/posts/${routeId}`,
        data: {
            article_id: articleId,
            author_id: authorId,
            author: readAuthorFromMap(authorMap, authorId),
            title: resolveArticleTitle(article),
            description: normalizeIdentity(article.summary) || undefined,
            image: resolveArticleCover(article),
            tags: normalizeArticleTags(article.tags),
            category: normalizeIdentity(article.category) || undefined,
            comment_count: articleCommentCountMap.get(articleId) || 0,
            like_count: articleLikeCountMap.get(articleId) || 0,
            published: publishedAt,
            updated: updatedAt,
            encrypted: false,
        },
    };
}

function scoreTagPreference(
    tags: string[],
    tagWeights: Map<string, number>,
): number {
    if (tags.length === 0 || tagWeights.size === 0) {
        return 0;
    }
    const uniqueTags = Array.from(
        new Set(tags.map((tag) => normalizePreferenceKey(tag)).filter(Boolean)),
    );
    if (uniqueTags.length === 0) {
        return 0;
    }
    let sum = 0;
    for (const tag of uniqueTags) {
        sum += tagWeights.get(tag) || 0;
    }
    return clamp01(sum / uniqueTags.length);
}

function scoreArticlePersonalization(
    authorId: string,
    tags: string[],
    category: string | undefined,
    profile: HomeFeedPreferenceProfile,
): number {
    if (
        profile.authorWeights.size === 0 &&
        profile.tagWeights.size === 0 &&
        profile.categoryWeights.size === 0
    ) {
        return 0;
    }
    const authorScore =
        profile.authorWeights.get(normalizeIdentity(authorId)) || 0;
    const tagScore = scoreTagPreference(tags, profile.tagWeights);
    const categoryScore =
        profile.categoryWeights.get(normalizePreferenceKey(category)) || 0;

    return clamp01(authorScore * 0.5 + tagScore * 0.3 + categoryScore * 0.2);
}

function scoreDiaryPersonalization(
    authorId: string,
    profile: HomeFeedPreferenceProfile,
): number {
    if (profile.authorWeights.size === 0) {
        return 0;
    }
    return clamp01(profile.authorWeights.get(normalizeIdentity(authorId)) || 0);
}

async function loadPreferenceProfile(
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
                .map((like) => normalizeIdentity(String(like.article_id || "")))
                .filter(Boolean),
        ),
    );
    const diaryIds = Array.from(
        new Set(
            (diaryLikes as Array<Record<string, unknown>>)
                .map((like) => normalizeIdentity(String(like.diary_id || "")))
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
        for (const tag of safeCsv(article.tags)) {
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
    // 偏好画像短 TTL 缓存，避免每次首页请求都回源统计用户互动历史。
    void cacheManager.set(
        "home-feed-profile",
        cacheKey,
        serializePreferenceProfile(profile),
    );
    return profile;
}

export function calculateRecencyScore(hoursSincePublish: number): number {
    const safeHours =
        Number.isFinite(hoursSincePublish) && hoursSincePublish > 0
            ? hoursSincePublish
            : 0;
    return clamp01(Math.exp(-safeHours / RECENCY_DECAY_HOURS));
}

export function calculateEngagementRaw(
    likes72h: number,
    comments72h: number,
): number {
    const likes = Math.max(0, likes72h);
    const comments = Math.max(0, comments72h);
    return Math.log1p(likes) * 0.45 + Math.log1p(comments) * 0.55;
}

export function normalizeMinMax(values: number[]): number[] {
    if (values.length === 0) {
        return [];
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return values.map(() => 0);
    }
    return values.map((value) => clamp01((value - min) / (max - min)));
}

export function calculateArticleQualityScore(entry: {
    body: string;
    data: {
        title: string;
        description?: string;
        image?: string;
    };
}): number {
    const titleLength = stripTextLength(entry.data.title);
    const summaryLength = stripTextLength(entry.data.description);
    const bodyLength = stripTextLength(entry.body);
    const hasCover = Boolean(normalizeIdentity(entry.data.image));

    const titleScore = clamp01(titleLength / 18);
    const summaryScore = summaryLength > 0 ? 1 : 0;
    const bodyScore = clamp01(bodyLength / 1600);
    const coverScore = hasCover ? 1 : 0;

    return clamp01(
        titleScore * 0.3 +
            summaryScore * 0.2 +
            bodyScore * 0.3 +
            coverScore * 0.2,
    );
}

export function calculateDiaryQualityScore(entry: {
    content: string;
    images: Array<unknown>;
}): number {
    const contentLength = stripTextLength(entry.content);
    const imageCount = Array.isArray(entry.images) ? entry.images.length : 0;
    const contentScore = clamp01(contentLength / 400);
    const imageScore = clamp01(imageCount / 4);
    return clamp01(contentScore * 0.75 + imageScore * 0.25);
}

export function calculateFinalScore(input: HomeFeedScoreInput): number {
    if (input.isLoggedIn) {
        return (
            input.recency * 0.56 +
            input.engagement * 0.19 +
            input.quality * 0.1 +
            input.personalization * 0.15
        );
    }
    return input.recency * 0.68 + input.engagement * 0.22 + input.quality * 0.1;
}

export function scoreHomeFeedCandidates(
    candidates: HomeFeedCandidate[],
    options: { now: Date; isLoggedIn: boolean },
): HomeFeedScoredCandidate[] {
    if (candidates.length === 0) {
        return [];
    }

    // 先对互动分做批内归一化，再按登录态权重计算最终分。
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

function pickCandidateByType(
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
        // 按 6:4 节奏模板取候选，冲突时自动回退到另一类型并逐步放宽约束。
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

function hydrateArticleEntry(entry: DirectusPostEntry): DirectusPostEntry {
    return {
        ...entry,
        data: {
            ...entry.data,
            published: toSafeDate(entry.data.published),
            updated: toSafeDate(entry.data.updated),
        },
    };
}

function hydrateHomeFeedCandidate(
    candidate: HomeFeedCandidate,
): HomeFeedCandidate {
    if (candidate.type === "article") {
        return {
            ...candidate,
            publishedAt: toSafeDate(candidate.publishedAt),
            entry: hydrateArticleEntry(candidate.entry),
        };
    }
    return {
        ...candidate,
        publishedAt: toSafeDate(candidate.publishedAt),
    };
}

function hydrateHomeFeedItem(item: HomeFeedItem): HomeFeedItem {
    if (item.type === "article") {
        return {
            ...item,
            publishedAt: toSafeDate(item.publishedAt),
            entry: hydrateArticleEntry(item.entry),
        };
    }
    return {
        ...item,
        publishedAt: toSafeDate(item.publishedAt),
    };
}

function hydrateHomeFeedCandidatePool(
    payload: HomeFeedCandidatePoolCachePayload,
): HomeFeedCandidatePoolCachePayload {
    return {
        ...payload,
        candidates: payload.candidates.map((candidate) =>
            hydrateHomeFeedCandidate(candidate),
        ),
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

function hasPreferenceProfile(profile: HomeFeedPreferenceProfile): boolean {
    return (
        profile.authorWeights.size > 0 ||
        profile.tagWeights.size > 0 ||
        profile.categoryWeights.size > 0
    );
}

function applyPreferenceProfileToCandidates(
    candidates: HomeFeedCandidate[],
    profile: HomeFeedPreferenceProfile,
): HomeFeedCandidate[] {
    if (!hasPreferenceProfile(profile)) {
        return candidates;
    }

    return candidates.map((candidate) => {
        if (candidate.type === "article") {
            return {
                ...candidate,
                personalizationScore: scoreArticlePersonalization(
                    candidate.authorId,
                    safeCsv(candidate.entry.data.tags),
                    candidate.entry.data.category,
                    profile,
                ),
            };
        }
        return {
            ...candidate,
            personalizationScore: scoreDiaryPersonalization(
                candidate.authorId,
                profile,
            ),
        };
    });
}

async function buildHomeFeedCandidatePool(options: {
    articleCandidateLimit: number;
    diaryCandidateLimit: number;
    engagementWindowHours: number;
    now: Date;
}): Promise<HomeFeedCandidatePoolCachePayload> {
    const articleFilters: JsonObject[] = [
        { is_public: { _eq: true } },
        excludeSpecialArticleSlugFilter(),
    ];
    if (import.meta.env.PROD) {
        articleFilters.push({ status: { _eq: "published" } });
    }

    const [articleRows, diaryRows] = await Promise.all([
        readMany("app_articles", {
            filter: { _and: articleFilters } as JsonObject,
            fields: [...ARTICLE_FEED_FIELDS],
            sort: ["-published_at", "-date_created"],
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

    const [
        articleAuthorMap,
        diaryAuthorMap,
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
        getAuthorBundle(articleAuthorIds),
        getAuthorBundle(diaryAuthorIds),
        fetchInteractionCountMap("app_article_likes", "article_id", articleIds),
        fetchInteractionCountMap(
            "app_article_comments",
            "article_id",
            articleIds,
            {
                requirePublic: true,
            },
        ),
        fetchInteractionCountMap(
            "app_article_likes",
            "article_id",
            articleIds,
            {
                windowStartIso,
            },
        ),
        fetchInteractionCountMap(
            "app_article_comments",
            "article_id",
            articleIds,
            {
                requirePublic: true,
                windowStartIso,
            },
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
                articleAuthorMap,
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
        author: readAuthorFromMap(diaryAuthorMap, row.author_id),
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

async function loadHomeFeedCandidatePool(options: {
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

    // 候选池按“无用户上下文”缓存，登录态只做轻量个性化重排，避免重复重查询。
    const payload = await buildHomeFeedCandidatePool({
        articleCandidateLimit: options.articleCandidateLimit,
        diaryCandidateLimit: options.diaryCandidateLimit,
        engagementWindowHours: options.engagementWindowHours,
        now: options.now,
    });
    void cacheManager.set("home-feed-candidates", candidateCacheKey, payload);
    return payload;
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

    const [candidatePool, preferenceProfile] = await Promise.all([
        loadHomeFeedCandidatePool({
            articleCandidateLimit,
            diaryCandidateLimit,
            engagementWindowHours,
            algoVersion,
            now,
        }),
        viewerId
            ? loadPreferenceProfile(viewerId, now, personalizationLookbackDays)
            : Promise.resolve(createEmptyPreferenceProfile()),
    ]);

    const finalCandidates = viewerId
        ? applyPreferenceProfileToCandidates(
              candidatePool.candidates,
              preferenceProfile,
          )
        : candidatePool.candidates;
    const scoredCandidates = scoreHomeFeedCandidates(finalCandidates, {
        now,
        isLoggedIn: Boolean(viewerId),
    });
    // 评分后再混排，保证每种类型都优先按自身得分顺序出队。
    const items = mixHomeFeedCandidates(scoredCandidates, limit);

    const result: HomeFeedBuildResult = {
        items,
        generatedAt: now.toISOString(),
        meta: {
            viewerId,
            limit,
            outputLimit,
            articleCandidateLimit,
            diaryCandidateLimit,
            articleCandidateCount: candidatePool.articleCandidateCount,
            diaryCandidateCount: candidatePool.diaryCandidateCount,
            engagementWindowHours,
            personalizationLookbackDays,
            algoVersion,
        },
    };

    void cacheManager.set("home-feed", cacheKey, result);
    return result;
}
