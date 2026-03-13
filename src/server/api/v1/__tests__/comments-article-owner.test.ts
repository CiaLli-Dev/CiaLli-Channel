import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminAccess } from "@/__tests__/helpers/mock-access";
import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/api/v1/shared", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/server/api/v1/shared")>();
    return {
        ...actual,
        requireAccess: vi.fn(),
        invalidateArticleInteractionAggregate: vi
            .fn()
            .mockResolvedValue(undefined),
    };
});

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    readOneById: vi.fn(),
    runWithDirectusPublicAccess: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    runWithDirectusUserAccess: vi.fn(
        async (_token: string, task: () => Promise<unknown>) => await task(),
    ),
    updateOne: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        invalidate: vi.fn(),
        invalidateByDomain: vi.fn(),
    },
}));

vi.mock("@/server/markdown/render", () => ({
    renderMarkdown: vi.fn().mockResolvedValue("<p>preview</p>"),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    cleanupOwnedOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
    extractDirectusAssetIdsFromMarkdown: vi
        .fn()
        .mockReturnValueOnce(["removed-file"])
        .mockReturnValueOnce([]),
}));

vi.mock("@/server/api/v1/me/_helpers", () => ({
    syncMarkdownFilesToVisibility: vi.fn().mockResolvedValue([]),
}));

import { requireAccess } from "@/server/api/v1/shared";
import { readOneById, updateOne } from "@/server/directus/client";
import { cleanupOwnedOrphanDirectusFiles } from "@/server/api/v1/shared/file-cleanup";
import { syncMarkdownFilesToVisibility } from "@/server/api/v1/me/_helpers";
import { handleArticleComments } from "@/server/api/v1/comments-article";

const mockedRequireAccess = vi.mocked(requireAccess);
const mockedReadOneById = vi.mocked(readOneById);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedCleanupOwnedOrphanDirectusFiles = vi.mocked(
    cleanupOwnedOrphanDirectusFiles,
);
const mockedSyncMarkdownFilesToVisibility = vi.mocked(
    syncMarkdownFilesToVisibility,
);

beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireAccess.mockResolvedValue({
        access: createAdminAccess(),
        accessToken: "admin-token",
    } as never);
});

describe("handleArticleComments PATCH", () => {
    it("管理员代编辑评论时沿用评论作者作为文件 owner", async () => {
        mockedReadOneById.mockResolvedValue({
            id: "comment-1",
            article_id: "article-1",
            author_id: "comment-author",
            body: "old body",
            is_public: true,
        } as never);
        mockedUpdateOne.mockResolvedValue({
            id: "comment-1",
            article_id: "article-1",
            author_id: "comment-author",
            body: "new body",
            is_public: true,
        } as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/articles/comments/comment-1",
            body: {
                body: "new body",
            },
        });

        const response = await handleArticleComments(
            ctx as unknown as APIContext,
            ["articles", "comments", "comment-1"],
        );

        expect(response.status).toBe(200);
        expect(mockedSyncMarkdownFilesToVisibility).toHaveBeenCalledWith(
            "new body",
            "comment-author",
            "public",
        );
        expect(mockedCleanupOwnedOrphanDirectusFiles).toHaveBeenCalledWith({
            candidateFileIds: ["removed-file"],
            ownerUserIds: ["comment-author"],
        });
    });
});
