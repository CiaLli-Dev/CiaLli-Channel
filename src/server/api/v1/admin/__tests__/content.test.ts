import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/api/v1/shared", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/server/api/v1/shared")>();
    return {
        ...actual,
        requireAdmin: vi.fn(),
    };
});

vi.mock("@/server/directus/client", () => ({
    deleteOne: vi.fn(),
    readMany: vi.fn(),
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

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    cleanupOwnedOrphanDirectusFiles: vi.fn(),
    collectAlbumFileIds: vi.fn().mockResolvedValue([]),
    collectArticleCommentCleanupCandidates: vi.fn().mockResolvedValue({
        candidateFileIds: [],
        ownerUserIds: [],
    }),
    collectDiaryCommentCleanupCandidates: vi.fn().mockResolvedValue({
        candidateFileIds: [],
        ownerUserIds: [],
    }),
    collectDiaryFileIds: vi.fn().mockResolvedValue([]),
    extractDirectusAssetIdsFromMarkdown: vi.fn(() => []),
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
    normalizeDirectusFileId: vi
        .fn()
        .mockImplementation((value: unknown) =>
            typeof value === "string" ? value : null,
        ),
}));

vi.mock("@/server/api/v1/comments-shared", () => ({
    deleteCommentWithDescendants: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin } from "@/server/api/v1/shared";
import { deleteOne, readMany, updateOne } from "@/server/directus/client";
import { collectDiaryFileIds } from "@/server/api/v1/shared/file-cleanup";
import { deleteCommentWithDescendants } from "@/server/api/v1/comments-shared";
import { handleAdminContent } from "@/server/api/v1/admin/content";

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedDeleteOne = vi.mocked(deleteOne);
const mockedCollectDiaryFileIds = vi.mocked(collectDiaryFileIds);
const mockedDeleteCommentWithDescendants = vi.mocked(
    deleteCommentWithDescendants,
);

function makeCtx(
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
): ReturnType<typeof createMockAPIContext> {
    return createMockAPIContext({
        method,
        url: `http://localhost:4321/api/v1/${path}`,
        params: { segments: path },
        body,
    });
}

describe("handleAdminContent diaries 权限收敛", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedRequireAdmin.mockResolvedValue({
            access: {
                isAdmin: true,
                user: {
                    id: "admin-1",
                },
            },
            accessToken: "test-access-token",
        } as never);
    });

    it("GET /admin/content?module=diaries 仅查询公开日记", async () => {
        mockedReadMany.mockResolvedValue([
            {
                id: "diary-1",
                short_id: "d-1",
                author_id: "user-1",
                content: "公开日记",
                status: "published",
                praviate: true,
                date_created: "2026-02-21T00:00:00.000Z",
            },
        ] as never);

        const ctx = makeCtx("admin/content?module=diaries");
        const response = await handleAdminContent(
            ctx as unknown as APIContext,
            ["content"],
        );

        expect(response.status).toBe(200);
        expect(mockedReadMany).toHaveBeenCalledTimes(1);
        const [, query] = mockedReadMany.mock.calls[0] ?? [];
        expect(query).toMatchObject({
            filter: { praviate: { _eq: true } },
            limit: 40,
        });

        const body = await parseResponseJson<{
            ok: boolean;
            items: Array<{ id: string; module: string }>;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.items[0]?.id).toBe("diary-1");
        expect(body.items[0]?.module).toBe("diaries");
    });

    it("PATCH 私密日记返回 404 且不触发更新", async () => {
        mockedReadMany.mockResolvedValue([] as never);

        const ctx = makeCtx("admin/content/diaries/diary-private", "PATCH", {
            status: "published",
        });
        const response = await handleAdminContent(
            ctx as unknown as APIContext,
            ["content", "diaries", "diary-private"],
        );

        expect(response.status).toBe(404);
        expect(mockedUpdateOne).not.toHaveBeenCalled();
    });

    it("DELETE 私密日记返回 404 且不触发删除", async () => {
        mockedReadMany.mockResolvedValue([] as never);

        const ctx = makeCtx("admin/content/diaries/diary-private", "DELETE");
        const response = await handleAdminContent(
            ctx as unknown as APIContext,
            ["content", "diaries", "diary-private"],
        );

        expect(response.status).toBe(404);
        expect(mockedDeleteOne).not.toHaveBeenCalled();
        expect(mockedCollectDiaryFileIds).not.toHaveBeenCalled();
    });

    it("PATCH 公开日记可正常更新", async () => {
        mockedReadMany.mockResolvedValueOnce([
            {
                id: "diary-public",
                short_id: "dp-1",
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({
            id: "diary-public",
            short_id: "dp-1",
            status: "published",
            praviate: true,
        } as never);

        const ctx = makeCtx("admin/content/diaries/diary-public", "PATCH", {
            status: "published",
        });
        const response = await handleAdminContent(
            ctx as unknown as APIContext,
            ["content", "diaries", "diary-public"],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledTimes(1);
    });

    it("DELETE 评论时走递归评论删除链路", async () => {
        mockedReadMany.mockResolvedValueOnce([
            {
                id: "comment-1",
                article_id: "article-1",
            },
        ] as never);

        const ctx = makeCtx(
            "admin/content/article-comments/comment-1",
            "DELETE",
        );
        const response = await handleAdminContent(
            ctx as unknown as APIContext,
            ["content", "article-comments", "comment-1"],
        );

        expect(response.status).toBe(200);
        expect(mockedDeleteCommentWithDescendants).toHaveBeenCalledWith(
            "app_article_comments",
            "comment-1",
        );
        expect(mockedDeleteOne).not.toHaveBeenCalled();
    });
});
