import type { HomeFeedScoreInput } from "./home-feed.types";
import { clamp01, normalizeIdentity } from "./home-feed-helpers";

const RECENCY_DECAY_HOURS = 36;

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
    const titleLength = entry.data.title
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
    const summaryLength = (entry.data.description ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
    const bodyLength = entry.body
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
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
    const contentLength = entry.content
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
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
