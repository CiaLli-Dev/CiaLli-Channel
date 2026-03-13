import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/directus/client", () => ({
    countItems: vi.fn(),
    countItemsGroupedByField: vi.fn(),
    createOne: vi.fn(),
    deleteOne: vi.fn(),
    readMany: vi.fn(),
    readOneById: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    cleanupOwnedOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
    extractDirectusAssetIdsFromMarkdown: vi.fn((value: string) => {
        const ids: string[] = [];
        if (value.includes("root-file")) ids.push("root-file");
        if (value.includes("child-file")) ids.push("child-file");
        if (value.includes("grand-file")) ids.push("grand-file");
        return ids;
    }),
}));

vi.mock("@/server/auth/session", () => ({
    getSessionUser: vi.fn(),
}));

vi.mock("@/server/markdown/render", () => ({
    renderMarkdown: vi.fn().mockResolvedValue("<p>preview</p>"),
}));

vi.mock("@/server/api/v1/shared", () => ({
    buildCommentTree: vi.fn(),
    requireAccess: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: vi.fn(),
}));

import { deleteOne, readMany, readOneById } from "@/server/directus/client";
import { cleanupOwnedOrphanDirectusFiles } from "@/server/api/v1/shared/file-cleanup";
import { deleteCommentWithDescendants } from "@/server/api/v1/comments-shared";

const mockedDeleteOne = vi.mocked(deleteOne);
const mockedReadMany = vi.mocked(readMany);
const mockedReadOneById = vi.mocked(readOneById);
const mockedCleanupOwnedOrphanDirectusFiles = vi.mocked(
    cleanupOwnedOrphanDirectusFiles,
);

beforeEach(() => {
    vi.clearAllMocks();
});

describe("deleteCommentWithDescendants", () => {
    it("删除评论树时会合并所有作者的静态资源候选", async () => {
        mockedReadOneById.mockResolvedValue({
            id: "root",
            body: "root-file",
            author_id: "root-user",
        } as never);
        mockedReadMany
            .mockResolvedValueOnce([
                {
                    id: "child",
                    body: "child-file",
                    author_id: "child-user",
                },
            ] as never)
            .mockResolvedValueOnce([
                {
                    id: "grand",
                    body: "grand-file",
                    author_id: "grand-user",
                },
            ] as never)
            .mockResolvedValueOnce([] as never);
        mockedDeleteOne.mockResolvedValue(undefined as never);

        await deleteCommentWithDescendants("app_article_comments", "root");

        expect(mockedDeleteOne).toHaveBeenNthCalledWith(
            1,
            "app_article_comments",
            "grand",
        );
        expect(mockedDeleteOne).toHaveBeenNthCalledWith(
            2,
            "app_article_comments",
            "child",
        );
        expect(mockedDeleteOne).toHaveBeenNthCalledWith(
            3,
            "app_article_comments",
            "root",
        );
        expect(mockedCleanupOwnedOrphanDirectusFiles).toHaveBeenCalledWith({
            candidateFileIds: ["root-file", "child-file", "grand-file"],
            ownerUserIds: ["root-user", "child-user", "grand-user"],
        });
    });
});
