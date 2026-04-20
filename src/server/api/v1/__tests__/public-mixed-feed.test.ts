import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import type { FeedPageResponse } from "@/server/application/feed/feed.types";

const { buildMixedFeedPageMock } = vi.hoisted(() => ({
    buildMixedFeedPageMock: vi.fn(),
}));

vi.mock("@/server/application/feed/mixed-feed-page.service", () => ({
    DEFAULT_MIXED_FEED_PAGE_LIMIT: 20,
    DEFAULT_MIXED_FEED_TOTAL_LIMIT: 60,
    MAX_MIXED_FEED_PAGE_LIMIT: 20,
    buildMixedFeedPage: buildMixedFeedPageMock,
}));

import {
    buildMixedFeedPage,
    DEFAULT_MIXED_FEED_PAGE_LIMIT,
    DEFAULT_MIXED_FEED_TOTAL_LIMIT,
} from "@/server/application/feed/mixed-feed-page.service";
import { handlePublicMixedFeed } from "@/server/api/v1/public/mixed-feed";

const mockedBuildMixedFeedPage = vi.mocked(buildMixedFeedPage);

function makeContext(): APIContext {
    return createMockAPIContext({
        method: "GET",
        url: "http://localhost:4321/api/v1/public/mixed-feed",
        params: { segments: "public/mixed-feed" },
    }) as unknown as APIContext;
}

describe("handlePublicMixedFeed", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("未传 limit 时默认仍使用 20 条分页", async () => {
        mockedBuildMixedFeedPage.mockResolvedValue({
            items: [],
            offset: 0,
            limit: DEFAULT_MIXED_FEED_PAGE_LIMIT,
            next_offset: 0,
            has_more: false,
            generated_at: "2026-03-27T00:00:00.000Z",
            total: 0,
        });

        const response = await handlePublicMixedFeed(makeContext(), [
            "public",
            "mixed-feed",
        ]);
        const payload = await parseResponseJson<
            FeedPageResponse & {
                ok: boolean;
            }
        >(response);

        expect(response.status).toBe(200);
        expect(payload.ok).toBe(true);
        expect(payload.limit).toBe(DEFAULT_MIXED_FEED_PAGE_LIMIT);
        expect(mockedBuildMixedFeedPage).toHaveBeenCalledWith({
            offset: 0,
            pageLimit: DEFAULT_MIXED_FEED_PAGE_LIMIT,
            totalLimit: DEFAULT_MIXED_FEED_TOTAL_LIMIT,
        });
    });

    it("带登录 cookie 时仍返回公共快照参数", async () => {
        mockedBuildMixedFeedPage.mockResolvedValue({
            items: [],
            offset: 0,
            limit: DEFAULT_MIXED_FEED_PAGE_LIMIT,
            next_offset: 0,
            has_more: false,
            generated_at: "2026-03-27T00:00:00.000Z",
            total: 0,
        });

        const context = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/public/mixed-feed",
            params: { segments: "public/mixed-feed" },
            cookies: {
                directus_access_token: "token",
            },
        }) as unknown as APIContext;

        const response = await handlePublicMixedFeed(context, [
            "public",
            "mixed-feed",
        ]);
        const payload = await parseResponseJson<
            FeedPageResponse & {
                ok: boolean;
            }
        >(response);

        expect(response.status).toBe(200);
        expect(payload.ok).toBe(true);
        expect(mockedBuildMixedFeedPage).toHaveBeenCalledWith({
            offset: 0,
            pageLimit: DEFAULT_MIXED_FEED_PAGE_LIMIT,
            totalLimit: DEFAULT_MIXED_FEED_TOTAL_LIMIT,
        });
    });
});
