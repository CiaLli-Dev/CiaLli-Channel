import { describe, it, expect, vi, beforeEach } from "vitest";

import { AppError } from "@/server/api/errors";
import { mockArticle } from "@/__tests__/helpers/mock-data";

// ── mock 依赖 ──

vi.mock("@/server/domain/article/article.repository", () => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    findPublicById: vi.fn(),
    findPublicBySlug: vi.fn(),
    findPublicByShortId: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    normalizeDirectusFileId: vi.fn((v: unknown) => {
        if (!v) return null;
        if (typeof v === "string") return v || null;
        if (typeof v === "object" && v !== null && "id" in v)
            return (v as { id: string }).id;
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

import * as articleRepo from "@/server/domain/article/article.repository";
import { cleanupOwnedOrphanDirectusFiles } from "@/server/api/v1/shared/file-cleanup";
import {
    createArticle,
    updateArticle,
    deleteArticle,
    getPublicArticle,
    getPublicArticleBySlug,
    getPublicArticleByShortId,
    checkArticleVisible,
    checkArticleCommentable,
} from "@/server/domain/article/article.service";

const mockedRepo = vi.mocked(articleRepo);
const mockedCleanup = vi.mocked(cleanupOwnedOrphanDirectusFiles);

beforeEach(() => {
    vi.clearAllMocks();
});

// ── createArticle ──

describe("createArticle", () => {
    it("创建时不再写入 published_at", async () => {
        const created = mockArticle({ status: "published" });
        mockedRepo.create.mockResolvedValue(created);

        await createArticle(
            { title: "Test", body_markdown: "content", status: "published" },
            "user-1",
        );

        const payload = mockedRepo.create.mock.calls[0][0];
        expect(payload).not.toHaveProperty("published_at");
    });

    it("传递正确的 author_id", async () => {
        const created = mockArticle();
        mockedRepo.create.mockResolvedValue(created);

        await createArticle(
            { title: "Test", body_markdown: "content" },
            "author-abc",
        );

        const payload = mockedRepo.create.mock.calls[0][0];
        expect(payload.author_id).toBe("author-abc");
    });

    it("默认值填充", async () => {
        const created = mockArticle();
        mockedRepo.create.mockResolvedValue(created);

        await createArticle(
            { title: "Test", body_markdown: "content" },
            "user-1",
        );

        const payload = mockedRepo.create.mock.calls[0][0];
        expect(payload.status).toBe("draft");
        expect(payload.allow_comments).toBe(true);
        expect(payload.is_public).toBe(true);
    });
});

// ── updateArticle ──

describe("updateArticle", () => {
    it("文章不存在 → 抛出", async () => {
        mockedRepo.findById.mockResolvedValue(null);

        await expect(
            updateArticle("no-id", { title: "Updated" }, "user-1", false),
        ).rejects.toThrow(AppError);
    });

    it("非 owner 非 admin → 403", async () => {
        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "owner-1" }),
        );

        await expect(
            updateArticle(
                "article-1",
                { title: "Updated" },
                "other-user",
                false,
            ),
        ).rejects.toThrow(AppError);

        try {
            await updateArticle(
                "article-1",
                { title: "Updated" },
                "other-user",
                false,
            );
        } catch (error) {
            expect((error as AppError).status).toBe(403);
        }
    });

    it("admin 可以更新他人文章", async () => {
        const article = mockArticle({ author_id: "owner-1" });
        mockedRepo.findById.mockResolvedValue(article);
        mockedRepo.update.mockResolvedValue(
            mockArticle({ title: "Admin Updated" }),
        );

        const result = await updateArticle(
            "article-1",
            { title: "Admin Updated" },
            "admin-user",
            true,
        );

        expect(result.title).toBe("Admin Updated");
    });

    it("非法状态转换 → 抛出", async () => {
        // archived → published 不合法
        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "user-1", status: "archived" }),
        );

        await expect(
            updateArticle(
                "article-1",
                { status: "published" },
                "user-1",
                false,
            ),
        ).rejects.toThrow(AppError);
    });

    it("合法状态转换 → 成功", async () => {
        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "user-1", status: "draft" }),
        );
        mockedRepo.update.mockResolvedValue(
            mockArticle({ status: "published" }),
        );

        const result = await updateArticle(
            "article-1",
            { status: "published" },
            "user-1",
            false,
        );

        expect(result.status).toBe("published");
    });

    it("正常更新 title", async () => {
        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "user-1" }),
        );
        mockedRepo.update.mockResolvedValue(
            mockArticle({ title: "New Title" }),
        );

        const result = await updateArticle(
            "article-1",
            { title: "New Title" },
            "user-1",
            false,
        );

        expect(result.title).toBe("New Title");
        expect(mockedRepo.update).toHaveBeenCalledWith("article-1", {
            title: "New Title",
        });
    });

    it("更换封面文件时清理旧文件", async () => {
        const oldCoverFileId = "aaaaaaaa-bbbb-1ccc-9ddd-eeeeeeeeeeee";
        const newCoverFileId = "11111111-2222-3333-9444-555555555555";

        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "user-1", cover_file: oldCoverFileId }),
        );
        mockedRepo.update.mockResolvedValue(
            mockArticle({ cover_file: newCoverFileId }),
        );

        await updateArticle(
            "article-1",
            { cover_file: newCoverFileId },
            "user-1",
            false,
            { cover_file: newCoverFileId }, // rawBody
        );

        expect(mockedCleanup).toHaveBeenCalledWith({
            candidateFileIds: [oldCoverFileId],
            ownerUserIds: ["user-1"],
        });
    });

    it("封面未变化时不清理", async () => {
        const coverFileId = "aaaaaaaa-bbbb-1ccc-9ddd-eeeeeeeeeeee";

        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "user-1", cover_file: coverFileId }),
        );
        mockedRepo.update.mockResolvedValue(
            mockArticle({ cover_file: coverFileId }),
        );

        await updateArticle(
            "article-1",
            { cover_file: coverFileId },
            "user-1",
            false,
            { cover_file: coverFileId },
        );

        expect(mockedCleanup).not.toHaveBeenCalled();
    });
});

// ── deleteArticle ──

describe("deleteArticle", () => {
    it("文章不存在 → 抛出", async () => {
        mockedRepo.findById.mockResolvedValue(null);

        await expect(deleteArticle("no-id", "user-1", false)).rejects.toThrow(
            AppError,
        );
    });

    it("非 owner 非 admin → 403", async () => {
        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "owner-1" }),
        );

        await expect(
            deleteArticle("article-1", "other-user", false),
        ).rejects.toThrow(AppError);
    });

    it("owner 删除成功", async () => {
        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "user-1", cover_file: null }),
        );
        mockedRepo.remove.mockResolvedValue(undefined);

        await deleteArticle("article-1", "user-1", false);

        expect(mockedRepo.remove).toHaveBeenCalledWith("article-1");
    });

    it("删除时清理封面文件", async () => {
        const coverFileId = "aaaaaaaa-bbbb-1ccc-9ddd-eeeeeeeeeeee";
        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "user-1", cover_file: coverFileId }),
        );
        mockedRepo.remove.mockResolvedValue(undefined);

        await deleteArticle("article-1", "user-1", false);

        expect(mockedCleanup).toHaveBeenCalledWith({
            candidateFileIds: [coverFileId],
            ownerUserIds: ["user-1"],
        });
    });

    it("admin 可以删除他人文章", async () => {
        mockedRepo.findById.mockResolvedValue(
            mockArticle({ author_id: "owner-1", cover_file: null }),
        );
        mockedRepo.remove.mockResolvedValue(undefined);

        await deleteArticle("article-1", "admin-user", true);

        expect(mockedRepo.remove).toHaveBeenCalledWith("article-1");
    });
});

// ── 查询 ──

describe("getPublicArticle", () => {
    it("存在 → 返回文章", async () => {
        const article = mockArticle();
        mockedRepo.findPublicById.mockResolvedValue(article);

        const result = await getPublicArticle("article-1");
        expect(result).toEqual(article);
    });

    it("不存在 → 返回 null", async () => {
        mockedRepo.findPublicById.mockResolvedValue(null);

        const result = await getPublicArticle("no-id");
        expect(result).toBeNull();
    });
});

describe("getPublicArticleBySlug", () => {
    it("存在 → 返回文章", async () => {
        const article = mockArticle({ slug: "my-slug" });
        mockedRepo.findPublicBySlug.mockResolvedValue(article);

        const result = await getPublicArticleBySlug("my-slug");
        expect(result).toEqual(article);
    });

    it("不存在 → 返回 null", async () => {
        mockedRepo.findPublicBySlug.mockResolvedValue(null);

        const result = await getPublicArticleBySlug("no-slug");
        expect(result).toBeNull();
    });
});

describe("getPublicArticleByShortId", () => {
    it("存在 → 返回文章", async () => {
        const article = mockArticle({ short_id: "xyz" });
        mockedRepo.findPublicByShortId.mockResolvedValue(article);

        const result = await getPublicArticleByShortId("xyz");
        expect(result).toEqual(article);
    });

    it("不存在 → 返回 null", async () => {
        mockedRepo.findPublicByShortId.mockResolvedValue(null);

        const result = await getPublicArticleByShortId("no-id");
        expect(result).toBeNull();
    });
});

// ── 工具方法 ──

describe("checkArticleVisible", () => {
    it("published + public → true", () => {
        expect(
            checkArticleVisible({ status: "published", is_public: true }),
        ).toBe(true);
    });

    it("draft → false", () => {
        expect(checkArticleVisible({ status: "draft", is_public: true })).toBe(
            false,
        );
    });

    it("published + private → false", () => {
        expect(
            checkArticleVisible({ status: "published", is_public: false }),
        ).toBe(false);
    });
});

describe("checkArticleCommentable", () => {
    it("published + public + allow_comments → true", () => {
        expect(
            checkArticleCommentable({
                status: "published",
                is_public: true,
                allow_comments: true,
            }),
        ).toBe(true);
    });

    it("allow_comments=false → false", () => {
        expect(
            checkArticleCommentable({
                status: "published",
                is_public: true,
                allow_comments: false,
            }),
        ).toBe(false);
    });

    it("draft + allow_comments → false", () => {
        expect(
            checkArticleCommentable({
                status: "draft",
                is_public: true,
                allow_comments: true,
            }),
        ).toBe(false);
    });
});
