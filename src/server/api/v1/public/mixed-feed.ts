import type { APIContext } from "astro";

import { fail, ok } from "@/server/api/response";
import {
    buildMixedFeedPage,
    DEFAULT_MIXED_FEED_PAGE_LIMIT,
    DEFAULT_MIXED_FEED_TOTAL_LIMIT,
    MAX_MIXED_FEED_PAGE_LIMIT,
} from "@/server/application/feed/mixed-feed-page.service";
import type { FeedPageResponse } from "@/server/application/feed/feed.types";

function parseNonNegativeInt(value: string | null, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

export async function handlePublicMixedFeed(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }
    if (segments.length !== 2) {
        return fail("未找到接口", 404);
    }

    const offset = parseNonNegativeInt(
        context.url.searchParams.get("offset"),
        0,
    );
    const parsedLimit = parseNonNegativeInt(
        context.url.searchParams.get("limit"),
        DEFAULT_MIXED_FEED_PAGE_LIMIT,
    );
    const limit = Math.min(MAX_MIXED_FEED_PAGE_LIMIT, Math.max(1, parsedLimit));

    const result: FeedPageResponse = await buildMixedFeedPage({
        offset,
        pageLimit: limit,
        totalLimit: DEFAULT_MIXED_FEED_TOTAL_LIMIT,
    });
    return ok(result);
}
