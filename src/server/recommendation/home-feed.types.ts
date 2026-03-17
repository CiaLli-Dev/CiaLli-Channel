import type { AuthorBundleItem } from "@/server/api/v1/shared/author-cache";
import type { AppDiary, AppDiaryImage } from "@/types/app";
import type { DirectusPostEntry } from "@/utils/content-utils";

export type HomeFeedItemType = "article" | "diary";

export type HomeFeedDiaryEntry = AppDiary & {
    author: AuthorBundleItem;
    images: AppDiaryImage[];
    comment_count: number;
    like_count: number;
};

export type HomeFeedScoreSignals = {
    recency: number;
    engagement: number;
    quality: number;
    personalization: number;
    engagementRaw: number;
    likes72h: number;
    comments72h: number;
};

type HomeFeedCandidateBase = {
    id: string;
    authorId: string;
    publishedAt: Date;
    qualityScore: number;
    personalizationScore: number;
    likes72h: number;
    comments72h: number;
};

export type HomeFeedArticleCandidate = HomeFeedCandidateBase & {
    type: "article";
    entry: DirectusPostEntry;
};

export type HomeFeedDiaryCandidate = HomeFeedCandidateBase & {
    type: "diary";
    entry: HomeFeedDiaryEntry;
};

export type HomeFeedCandidate =
    | HomeFeedArticleCandidate
    | HomeFeedDiaryCandidate;

export type HomeFeedScoredCandidate = HomeFeedCandidate & {
    score: number;
    signals: HomeFeedScoreSignals;
};

export type HomeFeedItem = HomeFeedScoredCandidate;

export type HomeFeedScoreInput = {
    recency: number;
    engagement: number;
    quality: number;
    personalization: number;
    isLoggedIn: boolean;
};

export type HomeFeedPreferenceProfile = {
    authorWeights: Map<string, number>;
    tagWeights: Map<string, number>;
    categoryWeights: Map<string, number>;
};

export type HomeFeedBuildOptions = {
    viewerId?: string | null;
    limit?: number;
    articleCandidateLimit?: number;
    diaryCandidateLimit?: number;
    outputLimit?: number;
    engagementWindowHours?: number;
    personalizationLookbackDays?: number;
    algoVersion?: string;
    now?: Date;
};

export type HomeFeedBuildMeta = {
    viewerId: string | null;
    limit: number;
    outputLimit: number;
    articleCandidateLimit: number;
    diaryCandidateLimit: number;
    articleCandidateCount: number;
    diaryCandidateCount: number;
    engagementWindowHours: number;
    personalizationLookbackDays: number;
    algoVersion: string;
};

export type HomeFeedBuildResult = {
    items: HomeFeedItem[];
    generatedAt: string;
    meta: HomeFeedBuildMeta;
};

export type HomeFeedPageResponse = {
    items: HomeFeedItem[];
    offset: number;
    limit: number;
    next_offset: number;
    has_more: boolean;
    generated_at: string;
    total: number;
};
