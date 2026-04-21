import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    cacheGetMock,
    cacheSetMock,
    getAuthorBundleMock,
    loadPublicArticleByIdMock,
    loadPublicArticleBySlugMock,
    readAuthorMock,
    readLatestArticleSummaryJobMock,
} = vi.hoisted(() => ({
    cacheGetMock: vi.fn(),
    cacheSetMock: vi.fn(),
    getAuthorBundleMock: vi.fn(),
    loadPublicArticleByIdMock: vi.fn(),
    loadPublicArticleBySlugMock: vi.fn(),
    readAuthorMock: vi.fn(),
    readLatestArticleSummaryJobMock: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: cacheGetMock,
        set: cacheSetMock,
    },
}));

vi.mock("@/server/directus/client", () => ({
    runWithDirectusServiceAccess: async <T>(task: () => Promise<T>) =>
        await task(),
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: getAuthorBundleMock,
}));

vi.mock("@/server/api/v1/public/_helpers", () => ({
    readAuthor: readAuthorMock,
}));

vi.mock("@/server/api/v1/shared", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/server/api/v1/shared")>();
    return {
        ...actual,
        loadPublicArticleById: loadPublicArticleByIdMock,
        loadPublicArticleBySlug: loadPublicArticleBySlugMock,
    };
});

vi.mock("@/server/ai-summary/jobs", () => ({
    readLatestArticleSummaryJob: readLatestArticleSummaryJobMock,
}));

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import { handlePublicArticlesRoute } from "@/server/application/public/articles.service";

describe("public/articles.service detail", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cacheGetMock.mockResolvedValue(null);
        cacheSetMock.mockResolvedValue(undefined);
        getAuthorBundleMock.mockResolvedValue(new Map());
        loadPublicArticleByIdMock.mockResolvedValue(null);
        loadPublicArticleBySlugMock.mockResolvedValue(null);
        readAuthorMock.mockReturnValue({
            id: "author-1",
            name: "Alice",
            display_name: "Alice",
            username: "alice",
        });
        readLatestArticleSummaryJobMock.mockResolvedValue(null);
    });

    it("公开文章详情返回 AI 总结状态，并允许轮询请求绕过缓存", async () => {
        loadPublicArticleByIdMock.mockResolvedValue({
            id: "article-1",
            short_id: "a1",
            author_id: "author-1",
            status: "published",
            title: "Hello",
            slug: "hello",
            summary: null,
            summary_source: "none",
            summary_generated_at: null,
            summary_model: null,
            summary_prompt_version: null,
            summary_content_hash: null,
            summary_error: null,
            ai_summary_enabled: true,
            body_markdown: "body",
            cover_file: null,
            cover_url: null,
            tags: [],
            category: null,
            allow_comments: true,
            is_public: true,
            date_created: null,
            date_updated: null,
        });
        readLatestArticleSummaryJobMock.mockResolvedValue({
            status: "processing",
        });

        const context = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/public/articles/article-1?bypass_cache=1",
        });
        const response = await handlePublicArticlesRoute(
            context as unknown as APIContext,
            ["public", "articles", "article-1"],
        );
        const body = await parseResponseJson<{
            item: { ai_summary_status: string };
        }>(response);

        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(body.item.ai_summary_status).toBe("processing");
        expect(cacheGetMock).not.toHaveBeenCalledWith(
            "article-detail",
            "article-1",
        );
        expect(cacheSetMock).not.toHaveBeenCalledWith(
            "article-detail",
            "article-1",
            expect.anything(),
        );
    });
});
