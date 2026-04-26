import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    readCommentById: vi.fn(),
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/repositories/comments/comments.repository", () => ({
    countComments: vi.fn(),
    countCommentLikesGrouped: vi.fn(),
    createDiaryCommentRecord: vi.fn(),
    deleteCommentById: vi.fn(),
    readCommentById: mocks.readCommentById,
    readComments: vi.fn(),
    readViewerCommentLikes: vi.fn(),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: mocks.withServiceRepositoryContext,
}));

import { AppError } from "@/server/api/errors";
import { validateReplyParent } from "@/server/api/v1/comments-shared";

const MISSING_PARENT_ID = "00000000-0000-4000-8000-000000000000";

async function readError(response: Response | null): Promise<{
    ok: boolean;
    error: {
        code: string;
        message: string;
    };
}> {
    if (!response) {
        throw new Error("expected error response");
    }
    return (await response.json()) as {
        ok: boolean;
        error: {
            code: string;
            message: string;
        };
    };
}

describe("validateReplyParent", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("uses service scope and maps missing article parent to business 404", async () => {
        mocks.readCommentById.mockResolvedValueOnce(null);

        const response = await validateReplyParent(
            "app_article_comments",
            MISSING_PARENT_ID,
            "article-1",
            "article_id",
        );

        expect(mocks.withServiceRepositoryContext).toHaveBeenCalledTimes(1);
        expect(response?.status).toBe(404);
        await expect(readError(response)).resolves.toMatchObject({
            error: {
                code: "COMMENT_PARENT_NOT_FOUND",
                message: "父评论不存在",
            },
        });
    });

    it("maps Directus parent lookup 403 to business 404", async () => {
        mocks.readCommentById.mockRejectedValueOnce(
            new AppError("DIRECTUS_FORBIDDEN", "权限不足", 403),
        );

        const response = await validateReplyParent(
            "app_article_comments",
            MISSING_PARENT_ID,
            "article-1",
            "article_id",
        );

        expect(response?.status).toBe(404);
        await expect(readError(response)).resolves.toMatchObject({
            error: {
                code: "COMMENT_PARENT_NOT_FOUND",
                message: "父评论不存在",
            },
        });
    });

    it("maps parent from another article to the same business 404", async () => {
        mocks.readCommentById.mockResolvedValueOnce({
            id: "parent-1",
            article_id: "article-2",
            parent_id: null,
        });

        const response = await validateReplyParent(
            "app_article_comments",
            "parent-1",
            "article-1",
            "article_id",
        );

        expect(response?.status).toBe(404);
        await expect(readError(response)).resolves.toMatchObject({
            error: {
                code: "COMMENT_PARENT_NOT_FOUND",
                message: "父评论不存在",
            },
        });
    });

    it("maps broken parent chain to business 404", async () => {
        mocks.readCommentById
            .mockResolvedValueOnce({
                id: "parent-1",
                article_id: "article-1",
                parent_id: "missing-parent",
            })
            .mockResolvedValueOnce({
                id: "parent-1",
                parent_id: "missing-parent",
            })
            .mockResolvedValueOnce(null);

        const response = await validateReplyParent(
            "app_article_comments",
            "parent-1",
            "article-1",
            "article_id",
        );

        expect(response?.status).toBe(404);
        await expect(readError(response)).resolves.toMatchObject({
            error: {
                code: "COMMENT_PARENT_NOT_FOUND",
            },
        });
    });

    it("returns a stable code when reply depth is exceeded", async () => {
        mocks.readCommentById
            .mockResolvedValueOnce({
                id: "parent-2",
                article_id: "article-1",
                parent_id: "parent-1",
            })
            .mockResolvedValueOnce({
                id: "parent-2",
                parent_id: "parent-1",
            })
            .mockResolvedValueOnce({
                id: "parent-1",
                parent_id: "root",
            })
            .mockResolvedValueOnce({
                id: "root",
                parent_id: null,
            });

        const response = await validateReplyParent(
            "app_article_comments",
            "parent-2",
            "article-1",
            "article_id",
        );

        expect(response?.status).toBe(400);
        await expect(readError(response)).resolves.toMatchObject({
            error: {
                code: "COMMENT_DEPTH_EXCEEDED",
                message: "最多支持三级回复",
            },
        });
    });

    it("allows a valid second-level reply parent", async () => {
        mocks.readCommentById
            .mockResolvedValueOnce({
                id: "parent-1",
                article_id: "article-1",
                parent_id: "root",
            })
            .mockResolvedValueOnce({
                id: "parent-1",
                parent_id: "root",
            })
            .mockResolvedValueOnce({
                id: "root",
                parent_id: null,
            });

        await expect(
            validateReplyParent(
                "app_article_comments",
                "parent-1",
                "article-1",
                "article_id",
            ),
        ).resolves.toBeNull();
    });
});
