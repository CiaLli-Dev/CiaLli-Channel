import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHomeFeedPage } from "@/server/application/feed/home-feed.service";
import type {
    HomeFeedBuildResult,
    HomeFeedDiaryEntry,
    HomeFeedItem,
} from "@/server/recommendation/home-feed.types";
import type { AppDiaryImage } from "@/types/app";
import type { DirectusPostEntry } from "@/utils/content-utils";

const { buildHomeFeedMock, readManyMock } = vi.hoisted(() => ({
    buildHomeFeedMock: vi.fn<() => Promise<HomeFeedBuildResult>>(),
    readManyMock: vi.fn(),
}));

vi.mock("@/server/recommendation/home-feed", () => ({
    buildHomeFeed: buildHomeFeedMock,
}));

vi.mock("@/server/directus/client", () => ({
    readMany: readManyMock,
    runWithDirectusServiceAccess: async <T>(
        task: () => Promise<T>,
    ): Promise<T> => await task(),
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
}): HomeFeedDiaryEntry {
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

function createArticleItem(params: {
    id: string;
    authorId: string;
}): HomeFeedItem {
    return {
        type: "article",
        id: params.id,
        authorId: params.authorId,
        publishedAt: BASE_NOW,
        entry: createArticleEntry(params),
    };
}

function createDiaryItem(params: {
    id: string;
    authorId: string;
}): HomeFeedItem {
    return {
        type: "diary",
        id: params.id,
        authorId: params.authorId,
        publishedAt: BASE_NOW,
        entry: createDiaryEntry(params),
    };
}

function createBuildResult(items: HomeFeedItem[]): HomeFeedBuildResult {
    return {
        items,
        generatedAt: BASE_NOW.toISOString(),
    };
}

afterEach(() => {
    buildHomeFeedMock.mockReset();
    readManyMock.mockReset();
});

describe("buildHomeFeedPage", () => {
    it("匿名用户返回默认 viewerState", async () => {
        buildHomeFeedMock.mockResolvedValue(
            createBuildResult([
                createArticleItem({
                    id: "article-public",
                    authorId: "author-public",
                }),
            ]),
        );

        const result = await buildHomeFeedPage({
            viewerId: null,
            offset: 0,
            pageLimit: 20,
            totalLimit: 20,
        });

        expect(readManyMock).not.toHaveBeenCalled();
        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.viewerState).toEqual({
            hasLiked: false,
            canDeleteOwn: false,
            canDeleteAdmin: false,
            canBlock: false,
        });
    });

    it("分页切片会按 10 条返回首页首屏结果", async () => {
        buildHomeFeedMock.mockResolvedValue(
            createBuildResult(
                Array.from({ length: 12 }, (_, index) =>
                    createArticleItem({
                        id: `article-${index + 1}`,
                        authorId: `author-${index + 1}`,
                    }),
                ),
            ),
        );

        const result = await buildHomeFeedPage({
            viewerId: null,
            offset: 0,
            pageLimit: 10,
            totalLimit: 12,
        });

        expect(readManyMock).not.toHaveBeenCalled();
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

    it("登录用户在服务端过滤已屏蔽作者并附带 viewerState", async () => {
        buildHomeFeedMock.mockResolvedValue(
            createBuildResult([
                createArticleItem({
                    id: "article-blocked",
                    authorId: "author-blocked",
                }),
                createArticleItem({
                    id: "article-own",
                    authorId: "viewer-1",
                }),
                createDiaryItem({
                    id: "diary-visible",
                    authorId: "author-visible",
                }),
            ]),
        );
        readManyMock
            .mockResolvedValueOnce([
                {
                    blocked_user_id: "author-blocked",
                },
            ])
            .mockResolvedValueOnce([
                {
                    article_id: "article-own",
                },
            ])
            .mockResolvedValueOnce([
                {
                    diary_id: "diary-visible",
                },
            ]);

        const result = await buildHomeFeedPage({
            viewerId: "viewer-1",
            viewerRoleName: "Site Admin",
            isViewerSystemAdmin: false,
            offset: 0,
            pageLimit: 20,
            totalLimit: 20,
        });

        expect(readManyMock).toHaveBeenCalledTimes(3);
        expect(result.total).toBe(2);
        expect(result.items.map((item) => item.id)).toEqual([
            "article-own",
            "diary-visible",
        ]);
        expect(result.items[0]?.viewerState).toEqual({
            hasLiked: true,
            canDeleteOwn: true,
            canDeleteAdmin: false,
            canBlock: false,
        });
        expect(result.items[1]?.viewerState).toEqual({
            hasLiked: true,
            canDeleteOwn: false,
            canDeleteAdmin: true,
            canBlock: true,
        });
    });

    it("首页返回项不再暴露推荐算法字段", async () => {
        buildHomeFeedMock.mockResolvedValue(
            createBuildResult([
                createArticleItem({
                    id: "article-public",
                    authorId: "author-public",
                }),
            ]),
        );

        const result = await buildHomeFeedPage({
            viewerId: null,
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
