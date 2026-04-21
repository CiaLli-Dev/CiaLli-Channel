import { describe, expect, it, vi } from "vitest";

import { loadArticleDetailViewData } from "@/server/application/public/article-detail-page.service";
import type { AppArticle } from "@/types/app";

function createArticle(overrides: Partial<AppArticle> = {}): AppArticle {
    return {
        id: "article-1",
        short_id: "post-1",
        slug: "post-1",
        author_id: "author-1",
        title: "Public article",
        summary: "summary",
        summary_source: "manual",
        summary_generated_at: null,
        summary_model: null,
        summary_prompt_version: null,
        summary_content_hash: null,
        summary_error: null,
        ai_summary_enabled: false,
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
            loadLatestAiSummaryJob: vi.fn().mockResolvedValue(null),
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
    });

    it("AI 总结任务处于 pending 时，在无摘要文章上显示骨架占位", async () => {
        const result = await loadArticleDetailViewData({
            article: createArticle({
                summary: null,
                summary_source: "none",
                ai_summary_enabled: true,
            }),
            mode: "public",
            sessionUserId: null,
            loadAuthorBundle: vi.fn().mockResolvedValue(new Map()),
            loadArticleInteractionSnapshot: vi.fn().mockResolvedValue({
                likeCount: 0,
                commentCount: 0,
                viewerLiked: false,
            }),
            loadPublicProfileByUserId: vi.fn().mockResolvedValue(null),
            loadProfileForViewerByUserId: vi.fn().mockResolvedValue(null),
            renderArticleMarkdown: vi.fn().mockResolvedValue("<p>body</p>"),
            loadLatestAiSummaryJob: vi.fn().mockResolvedValue({
                status: "pending",
            }),
        });

        expect(result.aiSummaryJobStatus).toBe("pending");
        expect(result.showPendingAiSummarySkeleton).toBe(true);
    });

    it("AI 总结任务进入终态失败时，不在 SSR 首屏继续展示生成中骨架", async () => {
        const result = await loadArticleDetailViewData({
            article: createArticle({
                summary: null,
                summary_source: "none",
                ai_summary_enabled: true,
            }),
            mode: "public",
            sessionUserId: null,
            loadAuthorBundle: vi.fn().mockResolvedValue(new Map()),
            loadArticleInteractionSnapshot: vi.fn().mockResolvedValue({
                likeCount: 0,
                commentCount: 0,
                viewerLiked: false,
            }),
            loadPublicProfileByUserId: vi.fn().mockResolvedValue(null),
            loadProfileForViewerByUserId: vi.fn().mockResolvedValue(null),
            renderArticleMarkdown: vi.fn().mockResolvedValue("<p>body</p>"),
            loadLatestAiSummaryJob: vi.fn().mockResolvedValue({
                status: "failed",
            }),
        });

        expect(result.aiSummaryJobStatus).toBe("failed");
        expect(result.showPendingAiSummarySkeleton).toBe(false);
    });
});
