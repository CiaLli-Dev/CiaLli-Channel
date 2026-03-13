import { buildHomeFeed } from "@/server/recommendation/home-feed";
import type {
    HomeFeedBuildOptions,
    HomeFeedPageResponse,
} from "@/server/recommendation/home-feed.types";

export type HomeFeedPageInput = Pick<
    HomeFeedBuildOptions,
    "viewerId" | "articleCandidateLimit" | "diaryCandidateLimit"
> & {
    offset: number;
    pageLimit: number;
    totalLimit: number;
};

/**
 * 首页 feed 的分页切片逻辑收敛到应用层，路由只负责解析请求参数。
 */
export async function buildHomeFeedPage(
    input: HomeFeedPageInput,
): Promise<HomeFeedPageResponse> {
    const feed = await buildHomeFeed({
        viewerId: input.viewerId ?? null,
        limit: input.totalLimit,
        outputLimit: input.totalLimit,
        articleCandidateLimit: input.articleCandidateLimit,
        diaryCandidateLimit: input.diaryCandidateLimit,
    });
    const items = feed.items.slice(
        input.offset,
        input.offset + input.pageLimit,
    );
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
