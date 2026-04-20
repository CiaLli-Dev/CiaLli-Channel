import type {
    FeedItem,
    FeedPageItem,
    FeedPageResponse,
    FeedViewerState,
} from "./feed.types";
import { buildMixedFeed } from "./mixed-feed.service";

export const MIXED_FEED_HOME_PAGE_LIMIT = 10;
export const DEFAULT_MIXED_FEED_PAGE_LIMIT = 20;
export const MAX_MIXED_FEED_PAGE_LIMIT = 20;
export const DEFAULT_MIXED_FEED_TOTAL_LIMIT = 60;

export type MixedFeedPageInput = {
    offset: number;
    pageLimit: number;
    totalLimit: number;
};

function buildDefaultViewerState(): FeedViewerState {
    return {
        hasLiked: false,
        canDeleteOwn: false,
        canDeleteAdmin: false,
    };
}

function attachViewerStateToItem(item: FeedItem): FeedPageItem {
    return {
        ...item,
        viewerState: buildDefaultViewerState(),
    };
}

/**
 * 首页 feed 的分页切片逻辑收敛到应用层，路由只负责解析请求参数。
 */
export async function buildMixedFeedPage(
    input: MixedFeedPageInput,
): Promise<FeedPageResponse> {
    const feed = await buildMixedFeed({
        limit: input.totalLimit,
    });
    const slicedItems = feed.items.slice(
        input.offset,
        input.offset + input.pageLimit,
    );
    const items = slicedItems.map((item) => attachViewerStateToItem(item));
    const nextOffset = input.offset + items.length;

    return {
        items,
        offset: input.offset,
        limit: input.pageLimit,
        next_offset: nextOffset,
        has_more: nextOffset < feed.items.length,
        generated_at: feed.generatedAt,
        total: feed.items.length,
    };
}
