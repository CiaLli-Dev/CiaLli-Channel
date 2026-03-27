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

type HomeFeedItemBase = {
    id: string;
    authorId: string;
    publishedAt: Date;
};

export type HomeFeedArticleItem = HomeFeedItemBase & {
    type: "article";
    entry: DirectusPostEntry;
};

export type HomeFeedDiaryItem = HomeFeedItemBase & {
    type: "diary";
    entry: HomeFeedDiaryEntry;
};

export type HomeFeedItem = HomeFeedArticleItem | HomeFeedDiaryItem;

export type HomeFeedViewerState = {
    hasLiked: boolean;
    canDeleteOwn: boolean;
    canDeleteAdmin: boolean;
    canBlock: boolean;
};

export type HomeFeedPageItem = HomeFeedItem & {
    viewerState: HomeFeedViewerState;
};

export type HomeFeedBuildOptions = {
    limit?: number;
    now?: Date;
};

export type HomeFeedBuildResult = {
    items: HomeFeedItem[];
    generatedAt: string;
};

export type HomeFeedPageResponse = {
    items: HomeFeedPageItem[];
    offset: number;
    limit: number;
    next_offset: number;
    has_more: boolean;
    generated_at: string;
    total: number;
};
