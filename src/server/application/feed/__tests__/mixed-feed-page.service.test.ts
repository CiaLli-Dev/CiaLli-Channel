import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMixedFeedPage } from "@/server/application/feed/mixed-feed-page.service";
import type {
    FeedBuildResult,
    FeedDiaryEntry,
    FeedItem,
} from "@/server/application/feed/feed.types";
import type { AppDiaryImage } from "@/types/app";
import type { DirectusPostEntry } from "@/utils/content-utils";

const { buildMixedFeedMock } = vi.hoisted(() => ({
    buildMixedFeedMock: vi.fn<() => Promise<FeedBuildResult>>(),
}));

vi.mock("@/server/application/feed/mixed-feed.service", () => ({
    buildMixedFeed: buildMixedFeedMock,
}));

const BASE_NOW = new Date("2026-03-16T12:00:00.000Z");

function createDiaryImages(diaryId: string): AppDiaryImage[] {
    return [
        {
            id: `${diaryId}-image-1`,
            status: "published",
            diary_id: diaryId,
            file_id: `${diaryId}-file-1`,
            image_url: null,
            caption: null,
            is_public: true,
            show_on_profile: true,
            sort: 1,
            date_created: BASE_NOW.toISOString(),
            date_updated: BASE_NOW.toISOString(),
        },
    ];
}

function createArticleEntry(params: {
    id: string;
    authorId: string;
}): DirectusPostEntry {
    return {
        id: params.id,
        slug: null,
        body: "测试文章正文",
        url: `/posts/${params.id}`,
        data: {
            article_id: params.id,
            author_id: params.authorId,
            author: {
                id: params.authorId,
                name: params.authorId,
                display_name: params.authorId,
                username: params.authorId,
            },
            title: `文章-${params.id}`,
            description: "摘要",
            image: "https://example.com/cover.jpg",
            tags: ["测试"],
            category: "tech",
            comment_count: 0,
            like_count: 0,
            published: BASE_NOW,
            updated: BASE_NOW,
            encrypted: false,
        },
    };
}

function createDiaryEntry(params: {
    id: string;
    authorId: string;
}): FeedDiaryEntry {
    return {
        id: params.id,
        short_id: params.id,
        author_id: params.authorId,
        status: "published",
        content: "测试日记正文",
        allow_comments: true,
        praviate: true,
        date_created: BASE_NOW.toISOString(),
        date_updated: BASE_NOW.toISOString(),
        author: {
            id: params.authorId,
            name: params.authorId,
            display_name: params.authorId,
            username: params.authorId,
        },
        images: createDiaryImages(params.id),
        comment_count: 0,
        like_count: 0,
    };
}

function createArticleItem(params: { id: string; authorId: string }): FeedItem {
    return {
        type: "article",
        id: params.id,
        authorId: params.authorId,
        publishedAt: BASE_NOW,
        entry: createArticleEntry(params),
    };
}

function createDiaryItem(params: { id: string; authorId: string }): FeedItem {
    return {
        type: "diary",
        id: params.id,
        authorId: params.authorId,
        publishedAt: BASE_NOW,
        entry: createDiaryEntry(params),
    };
}

function createBuildResult(items: FeedItem[]): FeedBuildResult {
    return {
        items,
        generatedAt: BASE_NOW.toISOString(),
    };
}

afterEach(() => {
    buildMixedFeedMock.mockReset();
});

describe("buildMixedFeedPage", () => {
    it("返回默认 feed viewer state", async () => {
        buildMixedFeedMock.mockResolvedValue(
            createBuildResult([
                createArticleItem({
                    id: "article-public",
                    authorId: "author-public",
                }),
            ]),
        );

        const result = await buildMixedFeedPage({
            offset: 0,
            pageLimit: 20,
            totalLimit: 20,
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.viewerState).toEqual({
            hasLiked: false,
            canDeleteOwn: false,
            canDeleteAdmin: false,
        });
    });

    it("分页切片会按 10 条返回首页首屏结果", async () => {
        buildMixedFeedMock.mockResolvedValue(
            createBuildResult(
                Array.from({ length: 12 }, (_, index) =>
                    createArticleItem({
                        id: `article-${index + 1}`,
                        authorId: `author-${index + 1}`,
                    }),
                ),
            ),
        );

        const result = await buildMixedFeedPage({
            offset: 0,
            pageLimit: 10,
            totalLimit: 12,
        });

        expect(result.items).toHaveLength(10);
        expect(result.items.map((item) => item.id)).toEqual([
            "article-1",
            "article-2",
            "article-3",
            "article-4",
            "article-5",
            "article-6",
            "article-7",
            "article-8",
            "article-9",
            "article-10",
        ]);
        expect(result.next_offset).toBe(10);
        expect(result.has_more).toBe(true);
        expect(result.total).toBe(12);
    });

    it("混合流中的日记与文章都返回默认 viewer state", async () => {
        buildMixedFeedMock.mockResolvedValue(
            createBuildResult([
                createArticleItem({
                    id: "article-visible",
                    authorId: "author-visible",
                }),
                createDiaryItem({
                    id: "diary-visible",
                    authorId: "author-visible",
                }),
            ]),
        );

        const result = await buildMixedFeedPage({
            offset: 0,
            pageLimit: 20,
            totalLimit: 20,
        });

        expect(result.total).toBe(2);
        expect(result.items.map((item) => item.id)).toEqual([
            "article-visible",
            "diary-visible",
        ]);
        expect(result.items[0]?.viewerState).toEqual({
            hasLiked: false,
            canDeleteOwn: false,
            canDeleteAdmin: false,
        });
        expect(result.items[1]?.viewerState).toEqual({
            hasLiked: false,
            canDeleteOwn: false,
            canDeleteAdmin: false,
        });
    });

    it("混合流返回项不再暴露推荐算法字段", async () => {
        buildMixedFeedMock.mockResolvedValue(
            createBuildResult([
                createArticleItem({
                    id: "article-public",
                    authorId: "author-public",
                }),
            ]),
        );

        const result = await buildMixedFeedPage({
            offset: 0,
            pageLimit: 20,
            totalLimit: 20,
        });

        expect(result.items[0]).not.toHaveProperty("score");
        expect(result.items[0]).not.toHaveProperty("signals");
        expect(result.items[0]).not.toHaveProperty("qualityScore");
        expect(result.items[0]).not.toHaveProperty("personalizationScore");
        expect(result.items[0]).not.toHaveProperty("likes72h");
        expect(result.items[0]).not.toHaveProperty("comments72h");
    });
});
