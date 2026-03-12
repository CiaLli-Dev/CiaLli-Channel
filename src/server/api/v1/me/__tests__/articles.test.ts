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
    extractDirectusAssetIdsFromMarkdown: vi.fn(() => []),
    collectArticleCommentCleanupCandidates: vi.fn().mockResolvedValue({
        candidateFileIds: [],
        ownerUserIds: [],
    }),
    mergeDirectusFileCleanupCandidates: vi.fn(
        (
            ...groups: Array<{
                candidateFileIds: string[];
                ownerUserIds: string[];
            }>
        ) => ({
            candidateFileIds: groups.flatMap((group) => group.candidateFileIds),
            ownerUserIds: groups.flatMap((group) => group.ownerUserIds),
        }),
    ),
    cleanupOwnedOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
}));

import { createOne, readMany, updateOne } from "@/server/directus/client";
import { ARTICLE_FIELDS } from "@/server/api/v1/shared/constants";
import {
    cleanupOwnedOrphanDirectusFiles,
    extractDirectusAssetIdsFromMarkdown,
} from "@/server/api/v1/shared/file-cleanup";
import { createWithShortId } from "@/server/utils/short-id";

import { handleMeArticles } from "@/server/api/v1/me/articles";

const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedCreateWithShortId = vi.mocked(createWithShortId);
const mockedCleanupOwnedOrphanDirectusFiles = vi.mocked(
    cleanupOwnedOrphanDirectusFiles,
);
const mockedExtractDirectusAssetIdsFromMarkdown = vi.mocked(
    extractDirectusAssetIdsFromMarkdown,
);

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

describe("GET /me/articles/working-draft", () => {
    it("无工作草稿时返回 null", async () => {
        mockedReadMany.mockResolvedValue([]);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/articles/working-draft",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "working-draft"],
        );

        expect(res.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            item: null;
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.item).toBeNull();
    });
});

describe("PUT /me/articles/working-draft", () => {
    it("无工作草稿时创建 draft", async () => {
        mockedReadMany.mockResolvedValue([]);
        mockedCreateWithShortId.mockResolvedValue(
            mockArticle({
                status: "draft",
                title: "",
                body_markdown: "",
                short_id: "draft-1",
            }),
        );

        const ctx = createMockAPIContext({
            method: "PUT",
            url: "http://localhost:4321/api/v1/me/articles/working-draft",
            body: {
                title: "",
                body_markdown: "",
                tags: [],
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "working-draft"],
        );

        expect(res.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            item: { status: string; short_id: string | null };
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.item.status).toBe("draft");
        expect(body.item.short_id).toBe("draft-1");
    });

    it("已有工作草稿时更新当前 draft", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "draft-1",
                short_id: "draft-1",
                status: "draft",
                title: "",
                body_markdown: "",
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "draft-1",
                short_id: "draft-1",
                status: "draft",
                title: "Draft Title",
                body_markdown: "",
            }),
        );

        const ctx = createMockAPIContext({
            method: "PUT",
            url: "http://localhost:4321/api/v1/me/articles/working-draft",
            body: {
                title: "Draft Title",
                body_markdown: "",
                tags: [],
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "working-draft"],
        );

        expect(res.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_articles",
            "draft-1",
            {
                title: "Draft Title",
                body_markdown: "",
                tags: [],
                status: "draft",
            },
            { fields: [...ARTICLE_FIELDS] },
        );
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
            { title: "Updated Title" },
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

    it("编辑 draft 时不会被强制发布", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "draft-1",
                status: "draft",
                title: "",
                body_markdown: "",
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "draft-1",
                status: "draft",
                title: "",
                body_markdown: "",
            }),
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/draft-1",
            body: {
                title: "",
                body_markdown: "",
                tags: [],
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "draft-1"],
        );

        expect(res.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_articles",
            "draft-1",
            { title: "", body_markdown: "", tags: [] },
            { fields: [...ARTICLE_FIELDS] },
        );
    });

    it("draft 发布时若标题正文不完整则失败", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "draft-1",
                status: "draft",
                title: "",
                body_markdown: "",
            }),
        ]);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/draft-1",
            body: {
                status: "published",
            },
        });
        const access = createMemberAccess();

        await expect(
            handleMeArticles(ctx as unknown as APIContext, access, [
                "articles",
                "draft-1",
            ]),
        ).rejects.toThrow();
    });

    it("正文纯文本 UUID 不会进入回收候选", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                body_markdown: "victim 6dc1edf9-a1f8-4191-bbe2-0fa6ff02ff69",
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(mockArticle({ id: "article-1" }));
        mockedExtractDirectusAssetIdsFromMarkdown.mockReturnValue([]);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: {
                body_markdown: "safe body",
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        expect(mockedCleanupOwnedOrphanDirectusFiles).not.toHaveBeenCalled();
    });

    it("正文合法资源 URL 被移除时会进入回收候选", async () => {
        const fileId = "a1b2c3d4-e5f6-1234-9abc-def012345678";
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                body_markdown: `![img](/api/v1/public/assets/${fileId})`,
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(mockArticle({ id: "article-1" }));
        mockedExtractDirectusAssetIdsFromMarkdown
            .mockReturnValueOnce([fileId])
            .mockReturnValueOnce([]);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: {
                body_markdown: "safe body",
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        expect(mockedCleanupOwnedOrphanDirectusFiles).toHaveBeenCalledWith({
            candidateFileIds: [fileId],
            ownerUserIds: [access.user.id],
        });
    });
});
