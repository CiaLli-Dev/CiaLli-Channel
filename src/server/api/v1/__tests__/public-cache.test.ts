import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";

const {
    handlePublicArticlesMock,
    handlePublicHomeFeedMock,
    handlePublicSiteSettingsMock,
} = vi.hoisted(() => ({
    handlePublicArticlesMock: vi.fn(),
    handlePublicHomeFeedMock: vi.fn(),
    handlePublicSiteSettingsMock: vi.fn(),
}));

vi.mock("@/server/api/v1/public/articles", () => ({
    handlePublicArticles: handlePublicArticlesMock,
}));

vi.mock("@/server/api/v1/public/home-feed", () => ({
    handlePublicHomeFeed: handlePublicHomeFeedMock,
}));

vi.mock("@/server/api/v1/public/site-settings", () => ({
    handlePublicSiteSettings: handlePublicSiteSettingsMock,
}));

vi.mock("@/server/api/v1/public/assets", () => ({
    handlePublicAsset: vi.fn(),
}));

vi.mock("@/server/api/v1/public/diaries", () => ({
    handlePublicDiaries: vi.fn(),
}));

vi.mock("@/server/api/v1/public/friends", () => ({
    handlePublicFriends: vi.fn(),
}));

vi.mock("@/server/api/v1/public/albums", () => ({
    handlePublicAlbums: vi.fn(),
}));

vi.mock("@/server/api/v1/public/registration", () => ({
    handlePublicRegistrationRequests: vi.fn(),
    handlePublicRegistrationCheck: vi.fn(),
    handlePublicRegistrationSession: vi.fn(),
}));

vi.mock("@/server/api/v1/public/user-home", () => ({
    handleUserHome: vi.fn(),
}));

import { handlePublic } from "@/server/api/v1/public";

function makeContext(
    path: string,
    cookies?: Record<string, string>,
): APIContext {
    return createMockAPIContext({
        method: "GET",
        url: `http://localhost:4321/api/v1/${path}`,
        params: { segments: path },
        cookies,
    }) as unknown as APIContext;
}

describe("handlePublic cache headers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        handlePublicArticlesMock.mockResolvedValue(
            new Response("{}", { status: 200 }),
        );
        handlePublicHomeFeedMock.mockResolvedValue(
            new Response("{}", { status: 200 }),
        );
        handlePublicSiteSettingsMock.mockResolvedValue(
            new Response("{}", { status: 200 }),
        );
    });

    it("public/articles 在带登录 cookie 时仍返回公共缓存头", async () => {
        const response = await handlePublic(
            makeContext("public/articles", {
                directus_access_token: "token",
            }),
            ["public", "articles"],
        );

        expect(response.headers.get("Cache-Control")).toBe(
            "public, s-maxage=300, stale-while-revalidate=900",
        );
    });

    it("public/home-feed 在带登录 cookie 时仍返回公共缓存头", async () => {
        const response = await handlePublic(
            makeContext("public/home-feed", {
                directus_access_token: "token",
            }),
            ["public", "home-feed"],
        );

        expect(response.headers.get("Cache-Control")).toBe(
            "public, s-maxage=300, stale-while-revalidate=900",
        );
    });

    it("public/site-settings 默认返回公共缓存头", async () => {
        const response = await handlePublic(
            makeContext("public/site-settings"),
            ["public", "site-settings"],
        );

        expect(response.headers.get("Cache-Control")).toBe(
            "public, s-maxage=300, stale-while-revalidate=900",
        );
    });
});
