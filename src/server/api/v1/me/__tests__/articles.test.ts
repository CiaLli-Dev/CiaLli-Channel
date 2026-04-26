import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import { mockArticle } from "@/__tests__/helpers/mock-data";
import type { AppError } from "@/server/api/errors";

// ── mock 依赖 ──

vi.mock("@/server/directus/client", () => ({
    readMany: vi.fn(),
    createOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    deleteDirectusFile: vi.fn(),
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

vi.mock("@/server/ai-summary/dispatch", () => ({
    enqueueAndTriggerArticleSummaryJob: vi
        .fn()
        .mockResolvedValue({ jobId: "job-1", status: "pending" }),
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
}));

vi.mock("@/server/api/v1/me/_helpers", () => ({
    deleteFileReferencesForOwner: vi.fn().mockResolvedValue(0),
    bindFileOwnerToUser: vi.fn().mockResolvedValue(undefined),
    detachManagedFiles: vi.fn().mockResolvedValue([]),
    renderMeMarkdownPreview: vi.fn().mockResolvedValue("<p>preview</p>"),
    syncManagedFileBinding: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
    syncMarkdownFileLifecycle: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
    syncMarkdownFilesToVisibility: vi.fn().mockResolvedValue([]),
}));

import {
    deleteDirectusFile,
    readMany,
    updateOne,
} from "@/server/directus/client";
import { enqueueAndTriggerArticleSummaryJob } from "@/server/ai-summary/dispatch";
import { cacheManager } from "@/server/cache/manager";
import { extractDirectusAssetIdsFromMarkdown } from "@/server/api/v1/shared/file-cleanup";
import { syncManagedFileBinding } from "@/server/api/v1/me/_helpers";
import { createWithShortId } from "@/server/utils/short-id";

import { handleMeArticles } from "@/server/api/v1/me/articles";

const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedEnqueueAndTriggerArticleSummaryJob = vi.mocked(
    enqueueAndTriggerArticleSummaryJob,
);
const mockedCacheInvalidate = vi.mocked(cacheManager.invalidate);
const mockedCreateWithShortId = vi.mocked(createWithShortId);
const mockedDeleteDirectusFile = vi.mocked(deleteDirectusFile);
const mockedExtractDirectusAssetIdsFromMarkdown = vi.mocked(
    extractDirectusAssetIdsFromMarkdown,
);
const mockedSyncManagedFileBinding = vi.mocked(syncManagedFileBinding);

function readLastArticleUpdatePayload(): Record<string, unknown> {
    const latestCall = mockedUpdateOne.mock.calls.at(-1);
    if (!latestCall) {
        throw new Error("updateOne was not called");
    }

    return latestCall[2] as Record<string, unknown>;
}

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
        expect(mockedCreateWithShortId).toHaveBeenCalledTimes(1);
    });

    it("非法创建载荷会映射为 validation 错误", async () => {
        const ctx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/articles",
            body: {
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

    it("标题为空白时创建发布文章失败且错误文案非空", async () => {
        const ctx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/articles",
            body: {
                title: "   ",
                body_markdown: "正文",
            },
        });
        const access = createMemberAccess();

        await expect(
            handleMeArticles(ctx as unknown as APIContext, access, [
                "articles",
            ]),
        ).rejects.toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
            message: expect.stringContaining("标题必填"),
        } satisfies Partial<AppError>);
        expect(mockedCreateWithShortId).not.toHaveBeenCalled();
    });

    it("正文为空白时创建发布文章失败且错误文案非空", async () => {
        const ctx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/articles",
            body: {
                title: "标题",
                body_markdown: "   ",
            },
        });
        const access = createMemberAccess();

        await expect(
            handleMeArticles(ctx as unknown as APIContext, access, [
                "articles",
            ]),
        ).rejects.toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
            message: expect.stringContaining("正文必填"),
        } satisfies Partial<AppError>);
        expect(mockedCreateWithShortId).not.toHaveBeenCalled();
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
        expect(mockedCreateWithShortId).toHaveBeenCalledTimes(1);
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
        expect(mockedUpdateOne).toHaveBeenCalledTimes(1);
    });

    it("清空工作草稿封面时 detach 旧封面", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "draft-1",
                short_id: "draft-1",
                status: "draft",
                title: "Draft",
                body_markdown: "",
                cover_file: "file-old",
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "draft-1",
                short_id: "draft-1",
                status: "draft",
                title: "Draft",
                body_markdown: "",
                cover_file: null,
            }),
        );

        const ctx = createMockAPIContext({
            method: "PUT",
            url: "http://localhost:4321/api/v1/me/articles/working-draft",
            body: {
                title: "Draft",
                body_markdown: "",
                cover_file: null,
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
        expect(readLastArticleUpdatePayload()).toMatchObject({
            cover_file: null,
        });
        expect(mockedSyncManagedFileBinding).toHaveBeenCalledWith(
            expect.objectContaining({
                previousFileValue: "file-old",
                nextFileValue: null,
            }),
        );
    });
});

// ── PATCH /me/articles/:id ──

describe("PATCH /me/articles/:id", () => {
    it("更新成功", async () => {
        const article = mockArticle({
            author_id: "user-1",
            short_id: "post-short",
        });
        mockedReadMany.mockResolvedValue([article]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                title: "Updated Title",
                short_id: "post-short",
            }),
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
        expect(mockedCacheInvalidate).toHaveBeenCalledWith(
            "article-detail",
            "article-1",
        );
        expect(mockedCacheInvalidate).toHaveBeenCalledWith(
            "article-detail",
            "post-short",
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
        expect(mockedUpdateOne).toHaveBeenCalledTimes(1);
    });

    it("清空文章封面时 detach 旧封面", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                cover_file: "file-old",
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "article-1",
                short_id: "post-short",
                cover_file: null,
            }),
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: { cover_file: null },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        expect(readLastArticleUpdatePayload()).toMatchObject({
            cover_file: null,
        });
        expect(mockedSyncManagedFileBinding).toHaveBeenCalledWith(
            expect.objectContaining({
                previousFileValue: "file-old",
                nextFileValue: null,
            }),
        );
    });
});

describe("PATCH /me/articles/:id AI summary", () => {
    it("编辑已发布文章并开启 AI 总结时会尝试排队", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                title: "Published Title",
                body_markdown: "# Body",
                ai_summary_enabled: false,
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                title: "Published Title",
                body_markdown: "# Body",
                ai_summary_enabled: true,
            }),
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: {
                ai_summary_enabled: true,
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        expect(mockedEnqueueAndTriggerArticleSummaryJob).toHaveBeenCalledWith({
            articleId: "article-1",
            kind: "on_publish",
        });
    });

    it("开启 AI 总结并提交空摘要时会解除手写摘要锁定并排队", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                title: "Published Title",
                body_markdown: "# Body",
                summary: "作者手写摘要",
                summary_source: "manual",
                ai_summary_enabled: false,
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                title: "Published Title",
                body_markdown: "# Body",
                summary: null,
                summary_source: "none",
                ai_summary_enabled: true,
            }),
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: {
                summary: null,
                ai_summary_enabled: true,
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        const payload = readLastArticleUpdatePayload();
        expect(payload.summary).toBeNull();
        expect(payload.summary_source).toBe("none");
        expect(mockedEnqueueAndTriggerArticleSummaryJob).toHaveBeenCalledWith({
            articleId: "article-1",
            kind: "on_publish",
        });
    });

    it("保存未改写的 AI 摘要时会保留 ai 来源", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                summary: "这篇文章介绍了嵌入式系统。",
                summary_source: "ai",
                ai_summary_enabled: true,
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                summary: "这篇文章介绍了嵌入式系统。",
                summary_source: "ai",
                ai_summary_enabled: true,
            }),
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: {
                summary: "这篇文章介绍了嵌入式系统。",
                ai_summary_enabled: true,
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        expect(readLastArticleUpdatePayload().summary_source).toBe("ai");
    });

    it("保存仅有空白差异的 AI 摘要时仍会保留 ai 来源", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                summary: "这篇文章介绍了嵌入式系统。\n并梳理了常见平台。",
                summary_source: "ai",
                ai_summary_enabled: true,
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                summary: "这篇文章介绍了嵌入式系统。\n并梳理了常见平台。",
                summary_source: "ai",
                ai_summary_enabled: true,
            }),
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: {
                summary: "  这篇文章介绍了嵌入式系统。\r\n并梳理了常见平台。  ",
                ai_summary_enabled: true,
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        expect(readLastArticleUpdatePayload().summary_source).toBe("ai");
    });

    it("用户手动改写 AI 摘要时会切回 manual 来源", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                summary: "这篇文章介绍了嵌入式系统。",
                summary_source: "ai",
                ai_summary_enabled: true,
            }),
        ]);
        mockedUpdateOne.mockResolvedValue(
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                short_id: "post-short",
                status: "published",
                summary: "我自己改写过的摘要。",
                summary_source: "manual",
                ai_summary_enabled: true,
            }),
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
            body: {
                summary: "我自己改写过的摘要。",
                ai_summary_enabled: true,
            },
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        const payload = readLastArticleUpdatePayload();
        expect(payload.summary_source).toBe("manual");
        expect(payload.summary_generated_at).toBeNull();
    });
});

describe("PATCH /me/articles/:id publish validation and file cleanup", () => {
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
        ).rejects.toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
            message: expect.any(String),
        } satisfies Partial<AppError>);
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
        expect(mockedDeleteDirectusFile).not.toHaveBeenCalled();
    });

    it("正文合法资源 URL 被移除时不会同步触发物理清理", async () => {
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
        expect(mockedDeleteDirectusFile).not.toHaveBeenCalled();
    });
});
