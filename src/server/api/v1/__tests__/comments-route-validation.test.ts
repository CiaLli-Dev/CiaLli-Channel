import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/api/v1/shared/auth", () => ({
    filterPublicStatus: vi.fn(() => ({
        status: { _eq: "published" },
    })),
    requireAccess: vi.fn(),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withPublicRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    withUserRepositoryContext: vi.fn(
        async (_token: string, task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/directus/client", () => ({
    countItems: vi.fn(),
    countItemsGroupedByField: vi.fn(),
    createOne: vi.fn(),
    deleteOne: vi.fn(),
    readMany: vi.fn(),
    readOneById: vi.fn(),
    updateOne: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: vi.fn().mockResolvedValue(null),
        invalidate: vi.fn().mockResolvedValue(undefined),
        invalidateByDomain: vi.fn().mockResolvedValue(undefined),
        set: vi.fn(),
    },
}));

vi.mock("@/server/api/v1/shared/article-interaction", () => ({
    invalidateArticleInteractionAggregate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/api/v1/shared/diary-interaction", () => ({
    invalidateDiaryInteractionAggregate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/markdown/render", () => ({
    renderMarkdown: vi.fn().mockResolvedValue("<p>preview</p>"),
}));

vi.mock("@/server/api/v1/me/_helpers", () => ({
    syncMarkdownFileLifecycle: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
    syncMarkdownFilesToVisibility: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/files/resource-lifecycle", () => ({
    resourceLifecycle: {
        releaseOwnerResources: vi.fn().mockResolvedValue({
            jobId: "release-job-1",
            status: "pending",
            candidateFileIds: [],
            deletedReferences: 0,
        }),
    },
}));

vi.mock("@/server/application/shared/search-index", () => ({
    searchIndex: {
        remove: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: vi.fn(),
}));

import { requireAccess } from "@/server/api/v1/shared/auth";
import { handleArticleComments } from "@/server/api/v1/comments-article";
import { handleDiaryComments } from "@/server/api/v1/comments-diary";
import { createOne, readMany, readOneById } from "@/server/directus/client";

const VALID_ARTICLE_ID = "11111111-2222-4333-8444-555555555555";
const VALID_DIARY_ID = "22222222-3333-4444-8555-666666666666";

const mockedRequireAccess = vi.mocked(requireAccess);
const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedReadOneById = vi.mocked(readOneById);

type ErrorResponse = {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};

beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireAccess.mockResolvedValue({
        access: createAdminAccess(),
        accessToken: "admin-token",
    } as never);
});

describe("comment route id validation", () => {
    it("POST /articles/not-a-uuid/comments 返回 400 且不触发鉴权或 Directus", async () => {
        const ctx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/articles/not-a-uuid/comments",
            body: { body: "hello" },
        });

        const response = await handleArticleComments(
            ctx as unknown as APIContext,
            ["articles", "not-a-uuid", "comments"],
        );

        const body = await parseResponseJson<ErrorResponse>(response);
        expect(response.status).toBe(400);
        expect(body.error.message).toBe("非法文章 ID");
        expect(mockedRequireAccess).not.toHaveBeenCalled();
        expect(mockedReadMany).not.toHaveBeenCalled();
        expect(mockedReadOneById).not.toHaveBeenCalled();
        expect(mockedCreateOne).not.toHaveBeenCalled();
    });

    it("GET /articles/not-a-uuid/comments 返回 400 且不读取 Directus", async () => {
        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/articles/not-a-uuid/comments",
        });

        const response = await handleArticleComments(
            ctx as unknown as APIContext,
            ["articles", "not-a-uuid", "comments"],
        );

        const body = await parseResponseJson<ErrorResponse>(response);
        expect(response.status).toBe(400);
        expect(body.error.message).toBe("非法文章 ID");
        expect(mockedReadMany).not.toHaveBeenCalled();
        expect(mockedReadOneById).not.toHaveBeenCalled();
    });

    it("PATCH /articles/comments/not-a-uuid 返回 400 且不读取 Directus", async () => {
        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/articles/comments/not-a-uuid",
            body: { body: "hello" },
        });

        const response = await handleArticleComments(
            ctx as unknown as APIContext,
            ["articles", "comments", "not-a-uuid"],
        );

        const body = await parseResponseJson<ErrorResponse>(response);
        expect(response.status).toBe(400);
        expect(body.error.message).toBe("非法评论 ID");
        expect(mockedRequireAccess).not.toHaveBeenCalled();
        expect(mockedReadOneById).not.toHaveBeenCalled();
    });

    it("日记评论路由非法 diaryId/commentId 返回 400 且不读取 Directus", async () => {
        const collectionCtx = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/diaries/not-a-uuid/comments",
            body: { body: "hello" },
        });
        const entityCtx = createMockAPIContext({
            method: "DELETE",
            url: "http://localhost:4321/api/v1/diaries/comments/not-a-uuid",
        });

        const collectionResponse = await handleDiaryComments(
            collectionCtx as unknown as APIContext,
            ["diaries", "not-a-uuid", "comments"],
        );
        const entityResponse = await handleDiaryComments(
            entityCtx as unknown as APIContext,
            ["diaries", "comments", "not-a-uuid"],
        );

        expect(collectionResponse.status).toBe(400);
        expect(entityResponse.status).toBe(400);
        expect(
            (await parseResponseJson<ErrorResponse>(collectionResponse)).error
                .message,
        ).toBe("非法日记 ID");
        expect(
            (await parseResponseJson<ErrorResponse>(entityResponse)).error
                .message,
        ).toBe("非法评论 ID");
        expect(mockedRequireAccess).not.toHaveBeenCalled();
        expect(mockedReadMany).not.toHaveBeenCalled();
        expect(mockedReadOneById).not.toHaveBeenCalled();
    });

    it("合法文章 UUID 但资源不可见时创建评论返回 404 且不创建评论", async () => {
        mockedReadMany.mockResolvedValueOnce([] as never);
        const ctx = createMockAPIContext({
            method: "POST",
            url: `http://localhost:4321/api/v1/articles/${VALID_ARTICLE_ID}/comments`,
            body: { body: "hello" },
        });

        const response = await handleArticleComments(
            ctx as unknown as APIContext,
            ["articles", VALID_ARTICLE_ID, "comments"],
        );

        const body = await parseResponseJson<ErrorResponse>(response);
        expect(response.status).toBe(404);
        expect(body.error.message).toBe("文章不存在或不可见");
        expect(mockedCreateOne).not.toHaveBeenCalled();
    });

    it("合法日记 UUID 但资源不可见时创建评论返回 404 且不创建评论", async () => {
        mockedReadMany.mockResolvedValueOnce([] as never);
        const ctx = createMockAPIContext({
            method: "POST",
            url: `http://localhost:4321/api/v1/diaries/${VALID_DIARY_ID}/comments`,
            body: { body: "hello" },
        });

        const response = await handleDiaryComments(
            ctx as unknown as APIContext,
            ["diaries", VALID_DIARY_ID, "comments"],
        );

        const body = await parseResponseJson<ErrorResponse>(response);
        expect(response.status).toBe(404);
        expect(body.error.message).toBe("日记不存在或不可见");
        expect(mockedCreateOne).not.toHaveBeenCalled();
    });
});
