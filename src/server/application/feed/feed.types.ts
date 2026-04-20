import type { AuthorBundleItem } from "@/server/api/v1/shared/author-cache";
import type { AppDiary, AppDiaryImage } from "@/types/app";
import type { DirectusPostEntry } from "@/utils/content-utils";

export type FeedItemType = "article" | "diary";

export type FeedDiaryEntry = AppDiary & {
    author: AuthorBundleItem;
    images: AppDiaryImage[];
    comment_count: number;
    like_count: number;
};

type FeedItemBase = {
    id: string;
    authorId: string;
    publishedAt: Date;
};

export type FeedArticleItem = FeedItemBase & {
    type: "article";
    entry: DirectusPostEntry;
};

export type FeedDiaryItem = FeedItemBase & {
    type: "diary";
    entry: FeedDiaryEntry;
};

export type FeedItem = FeedArticleItem | FeedDiaryItem;

export type FeedViewerState = {
    hasLiked: boolean;
    canDeleteOwn: boolean;
    canDeleteAdmin: boolean;
};

export type FeedPageItem = FeedItem & {
    viewerState: FeedViewerState;
};

export type FeedBuildOptions = {
    limit?: number;
    now?: Date;
};

export type FeedBuildResult = {
    items: FeedItem[];
    generatedAt: string;
};

export type FeedPageResponse = {
    items: FeedPageItem[];
    offset: number;
    limit: number;
    next_offset: number;
    has_more: boolean;
    generated_at: string;
    total: number;
};
