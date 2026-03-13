import { safeCsv } from "@/server/api/v1/shared";
import { countItemsGroupedByField } from "@/server/directus/client";
import {
    buildDirectusAssetUrl,
    buildPublicAssetUrl,
} from "@/server/directus-auth";
import type { JsonObject } from "@/types/json";
import type { AppArticle, AppDiaryImage } from "@/types/app";
import {
    resolveArticleDisplayTitle,
    type DirectusPostEntry,
} from "@/utils/content-utils";
import type {
    HomeFeedCandidate,
    HomeFeedDiaryEntry,
    HomeFeedItem,
    HomeFeedPreferenceProfile,
} from "./home-feed.types";

export type InteractionCollection =
    | "app_article_likes"
    | "app_article_comments"
    | "app_diary_likes"
    | "app_diary_comments";

export type InteractionRelationField = "article_id" | "diary_id";

export type HomeFeedAuthor = {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
};

export type HomeFeedAuthorMap = Map<string, HomeFeedAuthor>;

export type HomeFeedPreferenceProfileCachePayload = {
    authorWeights: Array<[string, number]>;
    tagWeights: Array<[string, number]>;
    categoryWeights: Array<[string, number]>;
};

export function clamp01(value: number): number {
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

export function normalizeIdentity(value: string | null | undefined): string {
    return String(value || "").trim();
}

export function normalizePreferenceKey(
    value: string | null | undefined,
): string {
    return String(value || "")
        .trim()
        .toLowerCase();
}

export function normalizePositiveInt(
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

export function toSafeDate(value: Date | string | null | undefined): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    const parsed = new Date(String(value || ""));
    if (Number.isNaN(parsed.getTime())) {
        return new Date(0);
    }
    return parsed;
}

export function createEmptyPreferenceProfile(): HomeFeedPreferenceProfile {
    return {
        authorWeights: new Map(),
        tagWeights: new Map(),
        categoryWeights: new Map(),
    };
}

export function serializePreferenceProfile(
    profile: HomeFeedPreferenceProfile,
): HomeFeedPreferenceProfileCachePayload {
    return {
        authorWeights: Array.from(profile.authorWeights.entries()),
        tagWeights: Array.from(profile.tagWeights.entries()),
        categoryWeights: Array.from(profile.categoryWeights.entries()),
    };
}

export function hydratePreferenceProfile(
    payload: HomeFeedPreferenceProfileCachePayload,
): HomeFeedPreferenceProfile {
    return {
        authorWeights: new Map(payload.authorWeights),
        tagWeights: new Map(payload.tagWeights),
        categoryWeights: new Map(payload.categoryWeights),
    };
}

export function incrementMapCounter(
    map: Map<string, number>,
    key: string,
): void {
    const normalizedKey = normalizeIdentity(key);
    if (!normalizedKey) {
        return;
    }
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + 1);
}

export function normalizeWeightMap(
    source: Map<string, number>,
): Map<string, number> {
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

export function buildCountMapByRelation(
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

export async function fetchInteractionCountMap(
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

    return await countItemsGroupedByField(collection, relationField, {
        _and: andFilters,
    } as JsonObject);
}

export function toFallbackAuthor(userId: string): {
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

export function readAuthorFromMap(
    authorMap: HomeFeedAuthorMap,
    userId: string,
): HomeFeedAuthor {
    const normalizedUserId = normalizeIdentity(userId);
    return (
        authorMap.get(normalizedUserId) || toFallbackAuthor(normalizedUserId)
    );
}

export function stripTextLength(value: string | null | undefined): number {
    return String(value || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
}

export function buildDiaryImageMap(
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

export function normalizeArticleTags(tags: AppArticle["tags"]): string[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.map((entry) => String(entry || "").trim()).filter(Boolean);
}

export function resolveArticlePublishedAt(article: AppArticle): Date {
    return toSafeDate(article.date_updated || article.date_created);
}

export function resolveArticleUpdatedAt(article: AppArticle): Date {
    return toSafeDate(article.date_updated || article.date_created);
}

export function resolveArticleTitle(article: AppArticle): string {
    return resolveArticleDisplayTitle(article);
}

export function resolveArticleCover(
    article: AppArticle,
    options?: { forceAuthenticatedCover?: boolean },
): string | undefined {
    const coverUrl = normalizeIdentity(article.cover_url);
    if (coverUrl) {
        return coverUrl;
    }
    const coverFile = normalizeIdentity(article.cover_file);
    if (!coverFile) {
        return undefined;
    }
    return (
        options?.forceAuthenticatedCover
            ? buildDirectusAssetUrl
            : buildPublicAssetUrl
    )(coverFile, {
        width: 1200,
        height: 675,
        fit: "cover",
    });
}

export function buildArticleFeedEntry(
    article: AppArticle,
    authorMap: HomeFeedAuthorMap,
    articleLikeCountMap: Map<string, number>,
    articleCommentCountMap: Map<string, number>,
    options?: { forceAuthenticatedCover?: boolean },
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
            image: resolveArticleCover(article, options),
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

export function scoreTagPreference(
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

export function scoreArticlePersonalization(
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

export function scoreDiaryPersonalization(
    authorId: string,
    profile: HomeFeedPreferenceProfile,
): number {
    if (profile.authorWeights.size === 0) {
        return 0;
    }
    return clamp01(profile.authorWeights.get(normalizeIdentity(authorId)) || 0);
}

export function hydrateArticleEntry(
    entry: DirectusPostEntry,
): DirectusPostEntry {
    return {
        ...entry,
        data: {
            ...entry.data,
            published: toSafeDate(entry.data.published),
            updated: toSafeDate(entry.data.updated),
        },
    };
}

export function hydrateHomeFeedCandidate(
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

export function hydrateHomeFeedItem(item: HomeFeedItem): HomeFeedItem {
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

export function hasPreferenceProfile(
    profile: HomeFeedPreferenceProfile,
): boolean {
    return (
        profile.authorWeights.size > 0 ||
        profile.tagWeights.size > 0 ||
        profile.categoryWeights.size > 0
    );
}

export function applyPreferenceProfileToCandidates(
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

export function buildDiaryFeedEntry(
    row: HomeFeedDiaryEntry,
    diaryAuthorMap: HomeFeedAuthorMap,
    diaryImageMap: Map<string, AppDiaryImage[]>,
    diaryCommentCountMap: Map<string, number>,
    diaryLikeCountMap: Map<string, number>,
): HomeFeedDiaryEntry {
    return {
        ...row,
        author: readAuthorFromMap(diaryAuthorMap, row.author_id),
        images: diaryImageMap.get(row.id) || [],
        comment_count: diaryCommentCountMap.get(row.id) || 0,
        like_count: diaryLikeCountMap.get(row.id) || 0,
    };
}
