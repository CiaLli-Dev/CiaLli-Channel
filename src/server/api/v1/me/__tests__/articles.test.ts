import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import { mockArticle } from "@/__tests__/helpers/mock-data";

// ── mock 依赖 ──

vi.mock("@/server/directus/client", () => ({
    readMany: vi.fn(),
    createOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    updateDirectusFileMetadata: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        invalidate: vi.fn(),
        invalidateByDomain: vi.fn(),
    },
}));

vi.mock("@/server/utils/short-id", () => ({
    createWithShortId: vi.fn(),
}));

vi.mock("@/server/markdown/render", () => ({
    renderMarkdown: vi.fn().mockResolvedValue("<p>preview</p>"),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    normalizeDirectusFileId: vi.fn((v: unknown) => {
        if (!v) return null;
        if (typeof v === "string") return v || null;
        return null;
    }),
    extractDirectusFileIdsFromUnknown: vi.fn(() => []),
    cleanupOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
}));

import {
    createOne,
    readMany,
    updateOne,
    deleteOne,
} from "@/server/directus/client";
import { ARTICLE_FIELDS } from "@/server/api/v1/shared/constants";
import { createWithShortId } from "@/server/utils/short-id";

import { handleMeArticles } from "@/server/api/v1/me/articles";

const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedDeleteOne = vi.mocked(deleteOne);
const mockedCreateWithShortId = vi.mocked(createWithShortId);

beforeEach(() => {
    vi.clearAllMocks();
});

// ── GET /me/articles ──

describe("GET /me/articles", () => {
    it("返回文章列表", async () => {
        const articles = [mockArticle(), mockArticle({ id: "article-2" })];
        mockedReadMany.mockResolvedValue(articles);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/articles",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles"],
        );

        expect(res.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            items: unknown[];
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.items).toHaveLength(2);
    });
});

// ── POST /me/articles ──

describe("POST /me/articles", () => {
    it("创建成功", async () => {
        const created = mockArticle({ title: "New Article" });
        mockedCreateWithShortId.mockResolvedValue(created);

        const ctx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/articles",
            body: {
                title: "New Article",
                body_markdown: "# Hello",
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles"],
        );

        expect(res.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            item: { title: string };
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.item.title).toBe("New Article");

        const createFn = mockedCreateWithShortId.mock.calls[0]?.[2];
        expect(typeof createFn).toBe("function");
        if (createFn) {
            await createFn("app_articles", { title: "probe" });
            expect(mockedCreateOne).toHaveBeenCalledWith(
                "app_articles",
                { title: "probe" },
                { fields: [...ARTICLE_FIELDS] },
            );
        }
    });

    it("缺失 title → 400 VALIDATION_ERROR", async () => {
        const ctx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/articles",
            body: {
                body_markdown: "content only",
            },
        });
        const access = createMemberAccess();

        // validateBody 会抛出 AppError，由 handler 自然传播
        await expect(
            handleMeArticles(ctx as unknown as APIContext, access, [
                "articles",
            ]),
        ).rejects.toThrow();
    });

    it("status=draft → VALIDATION_ERROR", async () => {
        const ctx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/articles",
            body: {
                title: "New Article",
                body_markdown: "# Hello",
                status: "draft",
            },
        });
        const access = createMemberAccess();

        await expect(
            handleMeArticles(ctx as unknown as APIContext, access, [
                "articles",
            ]),
        ).rejects.toThrow();
    });

    it("标题超 30（中文按 2）→ VALIDATION_ERROR", async () => {
        const ctx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/articles",
            body: {
                title: "你".repeat(16),
                body_markdown: "# Hello",
            },
        });
        const access = createMemberAccess();

        await expect(
            handleMeArticles(ctx as unknown as APIContext, access, [
                "articles",
            ]),
        ).rejects.toThrow();
    });
});

// ── GET /me/articles/:id ──

describe("GET /me/articles/:id", () => {
    it("返回单篇文章", async () => {
        const article = mockArticle({ author_id: "user-1" });
        // resolveOwnedArticle 使用 readMany 查询
        mockedReadMany.mockResolvedValue([article]);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            item: { id: string };
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.item.id).toBe("article-1");
    });

    it("文章不存在 → 404", async () => {
        mockedReadMany.mockResolvedValue([]);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/articles/no-id",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "no-id"],
        );

        expect(res.status).toBe(404);
    });
});

// ── PATCH /me/articles/:id ──

describe("PATCH /me/articles/:id", () => {
    it("更新成功", async () => {
        const article = mockArticle({ author_id: "user-1" });
        mockedReadMany.mockResolvedValue([article]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({ title: "Updated Title" }),
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: { title: "Updated Title" },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            item: { title: string };
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.item.title).toBe("Updated Title");
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_articles",
            "article-1",
            { title: "Updated Title", tags: [] },
            { fields: [...ARTICLE_FIELDS] },
        );
    });

    it("非 owner → 404", async () => {
        // resolveOwnedArticle 按 author_id 过滤，非 owner 查不到文章
        mockedReadMany.mockResolvedValue([]);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: { title: "Hack" },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(404);
    });
});

// ── DELETE /me/articles/:id ──

describe("DELETE /me/articles/:id", () => {
    it("删除成功", async () => {
        const article = mockArticle({ author_id: "user-1", cover_file: null });
        mockedReadMany.mockResolvedValue([article]);
        mockedDeleteOne.mockResolvedValue(undefined as never);

        const ctx = createMockAPIContext({
            method: "DELETE",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            id: string;
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.id).toBe("article-1");
    });

    it("非 owner → 404", async () => {
        // resolveOwnedArticle 按 author_id 过滤，非 owner 查不到文章
        mockedReadMany.mockResolvedValue([]);

        const ctx = createMockAPIContext({
            method: "DELETE",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(404);
    });
});

// ── 路由 fallback ──

describe("路由 fallback", () => {
    it("未知路径 → 404", async () => {
        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/articles/a/b/c",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "a", "b", "c"],
        );

        expect(res.status).toBe(404);
    });
});
