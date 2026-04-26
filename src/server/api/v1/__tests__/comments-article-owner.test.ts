import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminAccess } from "@/__tests__/helpers/mock-access";
import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/api/v1/shared/auth", () => ({
    requireAccess: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/article-interaction", () => ({
    invalidateArticleInteractionAggregate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    deleteDirectusFile: vi.fn(),
    readOneById: vi.fn(),
    runWithDirectusPublicAccess: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    runWithDirectusServiceAccess: vi.fn(
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
    extractDirectusAssetIdsFromMarkdown: vi
        .fn()
        .mockReturnValueOnce(["removed-file"])
        .mockReturnValueOnce([]),
}));

vi.mock("@/server/api/v1/me/_helpers", () => ({
    deleteFileReferencesForOwner: vi.fn().mockResolvedValue(0),
    detachMarkdownFiles: vi.fn().mockResolvedValue([]),
    syncMarkdownFileLifecycle: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
    syncMarkdownFilesToVisibility: vi.fn().mockResolvedValue([]),
}));

import { requireAccess } from "@/server/api/v1/shared/auth";
import {
    deleteDirectusFile,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { syncMarkdownFileLifecycle } from "@/server/api/v1/me/_helpers";
import { handleArticleComments } from "@/server/api/v1/comments-article";

const mockedRequireAccess = vi.mocked(requireAccess);
const mockedDeleteDirectusFile = vi.mocked(deleteDirectusFile);
const mockedReadOneById = vi.mocked(readOneById);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedSyncMarkdownFileLifecycle = vi.mocked(syncMarkdownFileLifecycle);
const COMMENT_ID = "11111111-2222-4333-8444-555555555555";

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
            id: COMMENT_ID,
            article_id: "article-1",
            author_id: "comment-author",
            body: "old body",
            is_public: true,
        } as never);
        mockedUpdateOne.mockResolvedValue({
            id: COMMENT_ID,
            article_id: "article-1",
            author_id: "comment-author",
            body: "new body",
            is_public: true,
        } as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: `http://localhost:4321/api/v1/articles/comments/${COMMENT_ID}`,
            body: {
                body: "new body",
            },
        });

        const response = await handleArticleComments(
            ctx as unknown as APIContext,
            ["articles", "comments", COMMENT_ID],
        );

        expect(response.status).toBe(200);
        expect(mockedSyncMarkdownFileLifecycle).toHaveBeenCalledWith({
            previousMarkdown: "old body",
            nextMarkdown: "new body",
            userId: "comment-author",
            visibility: "public",
            reference: {
                ownerCollection: "app_article_comments",
                ownerId: COMMENT_ID,
                ownerField: "body",
                referenceKind: "markdown_asset",
            },
        });
        expect(mockedDeleteDirectusFile).not.toHaveBeenCalled();
    });
});
