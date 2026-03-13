import type { JsonObject } from "@/types/json";
import { cacheManager } from "@/server/cache/manager";
import { countItems, readMany } from "@/server/directus/client";

type ArticleInteractionAggregate = {
    likeCount: number;
    commentCount: number;
};

export type ArticleInteractionSnapshot = ArticleInteractionAggregate & {
    viewerLiked: boolean;
};

function normalizeIdentity(value: string | null | undefined): string {
    return String(value || "").trim();
}

function buildAggregateKey(articleId: string): string {
    return `agg:${articleId}`;
}

function buildViewerKey(articleId: string, viewerId: string): string {
    return `viewer:${articleId}:${viewerId}`;
}

async function loadArticleInteractionAggregate(
    articleId: string,
): Promise<ArticleInteractionAggregate> {
    const normalizedArticleId = normalizeIdentity(articleId);
    if (!normalizedArticleId) {
        return {
            likeCount: 0,
            commentCount: 0,
        };
    }

    const cacheKey = buildAggregateKey(normalizedArticleId);
    const cached = await cacheManager.get<ArticleInteractionAggregate>(
        "article-interaction",
        cacheKey,
    );
    if (cached) {
        return cached;
    }

    // 点赞/评论统计独立查询，便于后续按需精确失效。
    const [likeCount, commentCount] = await Promise.all([
        countItems("app_article_likes", {
            _and: [
                { article_id: { _eq: normalizedArticleId } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject),
        countItems("app_article_comments", {
            _and: [
                { article_id: { _eq: normalizedArticleId } },
                { status: { _eq: "published" } },
                { is_public: { _eq: true } },
            ],
        } as JsonObject),
    ]);

    const value = {
        likeCount,
        commentCount,
    } satisfies ArticleInteractionAggregate;
    void cacheManager.set("article-interaction", cacheKey, value);
    return value;
}

async function loadViewerLikedState(
    articleId: string,
    viewerId: string | null | undefined,
): Promise<boolean> {
    const normalizedArticleId = normalizeIdentity(articleId);
    const normalizedViewerId = normalizeIdentity(viewerId);
    if (!normalizedArticleId || !normalizedViewerId) {
        return false;
    }

    const cacheKey = buildViewerKey(normalizedArticleId, normalizedViewerId);
    const cached = await cacheManager.get<boolean>(
        "article-interaction",
        cacheKey,
    );
    if (typeof cached === "boolean") {
        return cached;
    }

    const rows = await readMany("app_article_likes", {
        filter: {
            _and: [
                { article_id: { _eq: normalizedArticleId } },
                { user_id: { _eq: normalizedViewerId } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    const liked = rows.length > 0;
    void cacheManager.set("article-interaction", cacheKey, liked);
    return liked;
}

export async function loadArticleInteractionSnapshot(input: {
    articleId: string;
    viewerId?: string | null;
}): Promise<ArticleInteractionSnapshot> {
    const articleId = normalizeIdentity(input.articleId);
    const viewerId = normalizeIdentity(input.viewerId);
    if (!articleId) {
        return {
            likeCount: 0,
            commentCount: 0,
            viewerLiked: false,
        };
    }

    const [aggregate, viewerLiked] = await Promise.all([
        loadArticleInteractionAggregate(articleId),
        viewerId
            ? loadViewerLikedState(articleId, viewerId)
            : Promise.resolve(false),
    ]);

    return {
        ...aggregate,
        viewerLiked,
    };
}

export async function invalidateArticleInteractionAggregate(
    articleId: string,
): Promise<void> {
    const normalizedArticleId = normalizeIdentity(articleId);
    if (!normalizedArticleId) {
        return;
    }
    await cacheManager.invalidate(
        "article-interaction",
        buildAggregateKey(normalizedArticleId),
    );
}

export async function invalidateArticleInteractionViewerState(
    articleId: string,
    viewerId: string,
): Promise<void> {
    const normalizedArticleId = normalizeIdentity(articleId);
    const normalizedViewerId = normalizeIdentity(viewerId);
    if (!normalizedArticleId || !normalizedViewerId) {
        return;
    }
    await cacheManager.invalidate(
        "article-interaction",
        buildViewerKey(normalizedArticleId, normalizedViewerId),
    );
}
