import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import type { HomeFeedPageResponse } from "@/server/recommendation/home-feed.types";

const { buildHomeFeedPageMock, getSessionUserMock } = vi.hoisted(() => ({
    buildHomeFeedPageMock: vi.fn(),
    getSessionUserMock: vi.fn(),
}));

vi.mock("@/server/application/feed/home-feed.service", () => ({
    DEFAULT_HOME_FEED_PAGE_LIMIT: 20,
    DEFAULT_HOME_FEED_TOTAL_LIMIT: 60,
    MAX_HOME_FEED_PAGE_LIMIT: 20,
    buildHomeFeedPage: buildHomeFeedPageMock,
}));

vi.mock("@/server/auth/session", () => ({
    getSessionUser: getSessionUserMock,
}));

import {
    buildHomeFeedPage,
    DEFAULT_HOME_FEED_PAGE_LIMIT,
    DEFAULT_HOME_FEED_TOTAL_LIMIT,
} from "@/server/application/feed/home-feed.service";
import { handlePublicHomeFeed } from "@/server/api/v1/public/home-feed";

const mockedBuildHomeFeedPage = vi.mocked(buildHomeFeedPage);

function makeContext(): APIContext {
    return createMockAPIContext({
        method: "GET",
        url: "http://localhost:4321/api/v1/public/home-feed",
        params: { segments: "public/home-feed" },
    }) as unknown as APIContext;
}

describe("handlePublicHomeFeed", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("未传 limit 时默认仍使用 20 条分页", async () => {
        mockedBuildHomeFeedPage.mockResolvedValue({
            items: [],
            offset: 0,
            limit: DEFAULT_HOME_FEED_PAGE_LIMIT,
            next_offset: 0,
            has_more: false,
            generated_at: "2026-03-27T00:00:00.000Z",
            total: 0,
        });

        const response = await handlePublicHomeFeed(makeContext(), [
            "public",
            "home-feed",
        ]);
        const payload = await parseResponseJson<
            HomeFeedPageResponse & {
                ok: boolean;
            }
        >(response);

        expect(response.status).toBe(200);
        expect(payload.ok).toBe(true);
        expect(payload.limit).toBe(DEFAULT_HOME_FEED_PAGE_LIMIT);
        expect(getSessionUserMock).not.toHaveBeenCalled();
        expect(mockedBuildHomeFeedPage).toHaveBeenCalledWith({
            viewerId: null,
            viewerRoleName: null,
            isViewerSystemAdmin: false,
            offset: 0,
            pageLimit: DEFAULT_HOME_FEED_PAGE_LIMIT,
            totalLimit: DEFAULT_HOME_FEED_TOTAL_LIMIT,
        });
    });
});
