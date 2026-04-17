import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

const {
    assertCanMock,
    getAppAccessContextMock,
    getSessionAccessTokenMock,
    getSessionUserMock,
    withUserRepositoryContextMock,
} = vi.hoisted(() => ({
    assertCanMock: vi.fn(),
    getAppAccessContextMock: vi.fn(),
    getSessionAccessTokenMock: vi.fn(),
    getSessionUserMock: vi.fn(),
    withUserRepositoryContextMock: vi.fn(),
}));

vi.mock("@/server/auth/acl", () => ({
    assertCan: assertCanMock,
    getAppAccessContext: getAppAccessContextMock,
}));

vi.mock("@/server/auth/session", () => ({
    getSessionAccessToken: getSessionAccessTokenMock,
    getSessionUser: getSessionUserMock,
}));

vi.mock("@/server/directus/client", () => ({
    countItems: vi.fn(),
    createOne: vi.fn(),
    readMany: vi.fn(),
    readOneById: vi.fn(),
    updateOne: vi.fn(),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withUserRepositoryContext: withUserRepositoryContextMock,
}));

import {
    countItems,
    createOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import {
    handleMeArticleCommentLikes,
    handleMeArticleLikes,
    handleMeDiaryCommentLikes,
    handleMeDiaryLikes,
} from "@/server/api/v1/me/likes";
import { handleMe } from "@/server/api/v1/me";

const mockedCountItems = vi.mocked(countItems);
const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedReadOneById = vi.mocked(readOneById);
const mockedUpdateOne = vi.mocked(updateOne);

beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserMock.mockResolvedValue({
        id: "user-1",
        email: "alice@example.com",
    });
    getSessionAccessTokenMock.mockReturnValue("token");
    getAppAccessContextMock.mockResolvedValue(createMemberAccess());
    withUserRepositoryContextMock.mockImplementation(
        async (_token: string, run: () => Promise<Response>) => await run(),
    );
});

describe("POST /me/article-likes", () => {
    it("首次点赞成功，liked=true 且返回最新计数", async () => {
        mockedReadOneById.mockResolvedValueOnce({
            id: "article-1",
            status: "published",
            is_public: true,
        } as never);
        mockedReadMany.mockResolvedValueOnce([] as never);
        mockedCreateOne.mockResolvedValueOnce({ id: "like-1" } as never);
        mockedCountItems.mockResolvedValueOnce(1);

        const context = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/article-likes",
            body: { article_id: "article-1" },
        });
        const access = createMemberAccess();

        const response = await handleMeArticleLikes(
            context as unknown as APIContext,
            access,
            ["article-likes"],
        );
        const body = await parseResponseJson<{
            ok: boolean;
            liked: boolean;
            like_count: number;
        }>(response);

        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.liked).toBe(true);
        expect(body.like_count).toBe(1);
    });

    it("已点赞再次点击 -> 取消点赞，liked=false", async () => {
        mockedReadOneById.mockResolvedValueOnce({
            id: "article-1",
            status: "published",
            is_public: true,
        } as never);
        mockedReadMany.mockResolvedValueOnce([
            { id: "like-1", status: "published" },
        ] as never);
        mockedUpdateOne.mockResolvedValueOnce({ id: "like-1" } as never);
        mockedCountItems.mockResolvedValueOnce(0);

        const context = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/article-likes",
            body: { article_id: "article-1" },
        });
        const access = createMemberAccess();

        const response = await handleMeArticleLikes(
            context as unknown as APIContext,
            access,
            ["article-likes"],
        );
        const body = await parseResponseJson<{
            ok: boolean;
            liked: boolean;
            like_count: number;
        }>(response);

        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.liked).toBe(false);
        expect(body.like_count).toBe(0);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_article_likes",
            "like-1",
            {
                status: "archived",
            },
        );
    });

    it("历史 archived 记录再次点击 -> 重新点赞，liked=true", async () => {
        mockedReadOneById.mockResolvedValueOnce({
            id: "article-1",
            status: "published",
            is_public: true,
        } as never);
        mockedReadMany.mockResolvedValueOnce([
            { id: "like-1", status: "archived" },
        ] as never);
        mockedUpdateOne.mockResolvedValueOnce({ id: "like-1" } as never);
        mockedCountItems.mockResolvedValueOnce(1);

        const context = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/article-likes",
            body: { article_id: "article-1" },
        });
        const access = createMemberAccess();

        const response = await handleMeArticleLikes(
            context as unknown as APIContext,
            access,
            ["article-likes"],
        );
        const body = await parseResponseJson<{
            ok: boolean;
            liked: boolean;
            like_count: number;
        }>(response);

        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.liked).toBe(true);
        expect(body.like_count).toBe(1);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_article_likes",
            "like-1",
            {
                status: "published",
            },
        );
    });

    it("目标内容不可见 -> 返回 404", async () => {
        mockedReadOneById.mockResolvedValueOnce(null);
        mockedReadMany.mockResolvedValueOnce([] as never);

        const context = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/article-likes",
            body: { article_id: "article-1" },
        });
        const access = createMemberAccess();

        const response = await handleMeArticleLikes(
            context as unknown as APIContext,
            access,
            ["article-likes"],
        );

        expect(response.status).toBe(404);
    });
});

describe("GET /me/article-likes/state/:articleId", () => {
    it("当前用户已点赞时返回 liked=true", async () => {
        mockedReadMany.mockResolvedValueOnce([{ id: "like-1" }] as never);

        const context = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/article-likes/state/article-1",
        });
        const access = createMemberAccess();

        const response = await handleMeArticleLikes(
            context as unknown as APIContext,
            access,
            ["article-likes", "state", "article-1"],
        );
        const body = await parseResponseJson<{
            ok: boolean;
            article_id: string;
            liked: boolean;
        }>(response);

        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.article_id).toBe("article-1");
        expect(body.liked).toBe(true);
        expect(mockedReadMany).toHaveBeenCalledWith(
            "app_article_likes",
            expect.objectContaining({
                fields: ["id"],
                limit: 1,
            }),
        );
    });

    it("当前用户未点赞时返回 liked=false", async () => {
        mockedReadMany.mockResolvedValueOnce([] as never);

        const context = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/article-likes/state/article-1",
        });

        const response = await handleMeArticleLikes(
            context as unknown as APIContext,
            createMemberAccess(),
            ["article-likes", "state", "article-1"],
        );
        const body = await parseResponseJson<{
            ok: boolean;
            liked: boolean;
        }>(response);

        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.liked).toBe(false);
    });

    it("非法路径返回 404", async () => {
        const context = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/article-likes/state",
        });

        const response = await handleMeArticleLikes(
            context as unknown as APIContext,
            createMemberAccess(),
            ["article-likes", "state"],
        );

        expect(response.status).toBe(404);
    });

    it("非法方法返回 405", async () => {
        const context = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/article-likes/state/article-1",
        });

        const response = await handleMeArticleLikes(
            context as unknown as APIContext,
            createMemberAccess(),
            ["article-likes", "state", "article-1"],
        );

        expect(response.status).toBe(405);
    });

    it("未登录通过 me 路由访问时返回 401", async () => {
        getSessionUserMock.mockResolvedValueOnce(null);

        const context = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/article-likes/state/article-1",
        });

        const response = await handleMe(context as unknown as APIContext, [
            "article-likes",
            "state",
            "article-1",
        ]);

        expect(response.status).toBe(401);
    });
});

describe("点赞记录查询字段最小化", () => {
    it("四类 POST 点赞查询都只请求 id/status 字段", async () => {
        const access = createMemberAccess();

        mockedReadOneById
            .mockResolvedValueOnce({
                id: "article-1",
                status: "published",
                is_public: true,
            } as never)
            .mockResolvedValueOnce({
                id: "diary-1",
                status: "published",
                praviate: true,
            } as never)
            .mockResolvedValueOnce({
                id: "ac-1",
                article_id: "article-1",
                status: "published",
                is_public: true,
            } as never)
            .mockResolvedValueOnce({
                id: "article-1",
                status: "published",
                is_public: true,
            } as never)
            .mockResolvedValueOnce({
                id: "dc-1",
                diary_id: "diary-1",
                status: "published",
                is_public: true,
            } as never)
            .mockResolvedValueOnce({
                id: "diary-1",
                status: "published",
                praviate: true,
            } as never);

        mockedReadMany
            .mockResolvedValueOnce([] as never)
            .mockResolvedValueOnce([] as never)
            .mockResolvedValueOnce([] as never)
            .mockResolvedValueOnce([] as never);
        mockedCreateOne.mockResolvedValue({ id: "like-1" } as never);
        mockedCountItems.mockResolvedValue(1);

        const articleLikeContext = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/article-likes",
            body: { article_id: "article-1" },
        });
        const diaryLikeContext = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/diary-likes",
            body: { diary_id: "diary-1" },
        });
        const articleCommentLikeContext = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/article-comment-likes",
            body: { article_comment_id: "ac-1" },
        });
        const diaryCommentLikeContext = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/me/diary-comment-likes",
            body: { diary_comment_id: "dc-1" },
        });

        await handleMeArticleLikes(
            articleLikeContext as unknown as APIContext,
            access,
            ["article-likes"],
        );
        await handleMeDiaryLikes(
            diaryLikeContext as unknown as APIContext,
            access,
            ["diary-likes"],
        );
        await handleMeArticleCommentLikes(
            articleCommentLikeContext as unknown as APIContext,
            access,
            ["article-comment-likes"],
        );
        await handleMeDiaryCommentLikes(
            diaryCommentLikeContext as unknown as APIContext,
            access,
            ["diary-comment-likes"],
        );

        expect(mockedReadMany).toHaveBeenCalledWith(
            "app_article_likes",
            expect.objectContaining({
                fields: ["id", "status"],
                limit: 1,
            }),
        );
        expect(mockedReadMany).toHaveBeenCalledWith(
            "app_diary_likes",
            expect.objectContaining({
                fields: ["id", "status"],
                limit: 1,
            }),
        );
        expect(mockedReadMany).toHaveBeenCalledWith(
            "app_article_comment_likes",
            expect.objectContaining({
                fields: ["id", "status"],
                limit: 1,
            }),
        );
        expect(mockedReadMany).toHaveBeenCalledWith(
            "app_diary_comment_likes",
            expect.objectContaining({
                fields: ["id", "status"],
                limit: 1,
            }),
        );
    });
});
