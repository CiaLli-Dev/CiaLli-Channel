import type { AppArticle } from "@/types/app";

export function normalizeTags(tags: AppArticle["tags"]): string[] {
    if (!tags || !Array.isArray(tags)) {
        return [];
    }
    return tags.map((item) => String(item).trim()).filter(Boolean);
}

export function isProtectedContentBody(
    value: string | null | undefined,
): boolean {
    return String(value || "")
        .trim()
        .startsWith("CL2:");
}

function resolvePostDate(value: string | null | undefined): Date {
    const parsed = value ? new Date(value) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function resolvePublishedAt(post: AppArticle): Date {
    return resolvePostDate(post.date_updated || post.date_created);
}

export function resolveUpdatedAt(post: AppArticle): Date {
    return resolvePostDate(post.date_updated || post.date_created);
}

export function buildPostUrl(
    shortId: string | null,
    articleId: string,
): string {
    return `/posts/${shortId || articleId}`;
}
