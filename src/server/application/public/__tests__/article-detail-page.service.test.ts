import { describe, expect, it, vi } from "vitest";

import {
    ARTICLE_DETAIL_PRIVATE_CACHE_CONTROL,
    ARTICLE_DETAIL_PUBLIC_CACHE_CONTROL,
    loadArticleDetailViewData,
    resolveArticleDetailCacheControl,
    resolveArticleDetailRoute,
} from "@/server/application/public/article-detail-page.service";
import type { AppArticle } from "@/types/app";

function createArticle(overrides: Partial<AppArticle> = {}): AppArticle {
    return {
        id: "article-1",
        short_id: "post-1",
        slug: "post-1",
        author_id: "author-1",
        title: "Public article",
        summary: "summary",
        body_markdown: "body",
        cover_file: null,
        cover_url: null,
        tags: [],
        category: null,
        allow_comments: true,
        status: "published",
        is_public: true,
        date_created: null,
        date_updated: null,
        ...overrides,
    };
}

describe("article-detail-page.service", () => {
    it("公开文章命中时不会读取 session 或 owner fallback", async () => {
        const loadSessionUser = vi.fn();
        const getSessionAccessToken = vi.fn();
        const loadOwnerArticleByRoute = vi.fn();

        const result = await resolveArticleDetailRoute({
            routeId: "post-1",
            loadPublicArticleByRoute: vi
                .fn()
                .mockResolvedValue(createArticle()),
            loadSessionUser,
            getSessionAccessToken,
            loadOwnerArticleByRoute,
        });

        expect(result).toMatchObject({
            mode: "public",
            sessionUserId: null,
        });
        expect(loadSessionUser).not.toHaveBeenCalled();
        expect(getSessionAccessToken).not.toHaveBeenCalled();
        expect(loadOwnerArticleByRoute).not.toHaveBeenCalled();
    });

    it("公开未命中且作者本人回退命中时返回 owner 模式", async () => {
        const result = await resolveArticleDetailRoute({
            routeId: "draft-1",
            loadPublicArticleByRoute: vi.fn().mockResolvedValue(null),
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "author-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerArticleByRoute: vi.fn().mockResolvedValue(
                createArticle({
                    status: "draft",
                    is_public: false,
                }),
            ),
        });

        expect(result).toMatchObject({
            mode: "owner",
            sessionUserId: "author-1",
        });
        expect(
            resolveArticleDetailCacheControl({
                responseStatus: 200,
                mode: result.mode,
            }),
        ).toBe(ARTICLE_DETAIL_PRIVATE_CACHE_CONTROL);
    });

    it("公开模式加载视图数据时只读取公共 profile，并把 interaction viewerId 固定为空", async () => {
        const loadPublicProfileByUserId = vi.fn().mockResolvedValue({
            user_id: "author-1",
            username: "alice",
            display_name: "Alice",
            bio: null,
            avatar_file: null,
            social_links: null,
            is_official: false,
        });
        const loadProfileForViewerByUserId = vi.fn();
        const loadArticleInteractionSnapshotMock = vi.fn().mockResolvedValue({
            likeCount: 12,
            commentCount: 3,
            viewerLiked: false,
        });

        const result = await loadArticleDetailViewData({
            article: createArticle(),
            mode: "public",
            sessionUserId: null,
            loadAuthorBundle: vi.fn().mockResolvedValue(new Map()),
            loadArticleInteractionSnapshot: loadArticleInteractionSnapshotMock,
            loadPublicProfileByUserId,
            loadProfileForViewerByUserId,
            renderArticleMarkdown: vi.fn().mockResolvedValue("<p>body</p>"),
        });

        expect(result.authorProfile).toEqual(
            expect.objectContaining({
                username: "alice",
            }),
        );
        expect(loadPublicProfileByUserId).toHaveBeenCalledWith("author-1");
        expect(loadProfileForViewerByUserId).not.toHaveBeenCalled();
        expect(loadArticleInteractionSnapshotMock).toHaveBeenCalledWith({
            articleId: "article-1",
            viewerId: null,
        });
        expect(
            resolveArticleDetailCacheControl({
                responseStatus: 404,
                mode: "public",
            }),
        ).toBe(ARTICLE_DETAIL_PUBLIC_CACHE_CONTROL);
    });
});
