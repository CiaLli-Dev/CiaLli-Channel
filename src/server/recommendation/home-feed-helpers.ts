import {
    buildDirectusAssetUrl,
    buildPublicAssetUrl,
} from "@/server/directus-auth";
import type { AuthorBundleItem } from "@/server/api/v1/shared/author-cache";
import type { AppArticle, AppDiaryImage } from "@/types/app";
import {
    resolveArticleDisplayTitle,
    type DirectusPostEntry,
} from "@/utils/content-utils";

type HomeFeedAuthorMap = Map<string, AuthorBundleItem>;

export function normalizeIdentity(value: string | null | undefined): string {
    return String(value || "").trim();
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

function toFallbackAuthor(userId: string): AuthorBundleItem {
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
): AuthorBundleItem {
    const normalizedUserId = normalizeIdentity(userId);
    return (
        authorMap.get(normalizedUserId) || toFallbackAuthor(normalizedUserId)
    );
}

function normalizeArticleTags(tags: AppArticle["tags"]): string[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function resolveArticleCover(
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
    const createdAt = toSafeDate(article.date_created);
    const updatedAt = toSafeDate(article.date_updated || article.date_created);

    return {
        id: routeId,
        slug: normalizeIdentity(article.slug) || null,
        // 首页卡片继续只使用摘要，避免把正文大字段带到信息流里。
        body: normalizeIdentity(article.summary),
        url: `/posts/${routeId}`,
        data: {
            article_id: articleId,
            author_id: authorId,
            author: readAuthorFromMap(authorMap, authorId),
            title: resolveArticleDisplayTitle(article),
            description: normalizeIdentity(article.summary) || undefined,
            image: resolveArticleCover(article, options),
            tags: normalizeArticleTags(article.tags),
            category: normalizeIdentity(article.category) || undefined,
            comment_count: articleCommentCountMap.get(articleId) || 0,
            like_count: articleLikeCountMap.get(articleId) || 0,
            published: createdAt,
            updated: updatedAt,
            encrypted: false,
        },
    };
}
