import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildMixedFeed } from "@/server/application/feed/mixed-feed.service";
import type { AuthorBundleItem } from "@/server/api/v1/shared/author-cache";
import type { AppArticle, AppDiary, AppDiaryImage } from "@/types/app";

const {
    cacheGetMock,
    cacheSetMock,
    readManyMock,
    countItemsGroupedByFieldMock,
    getAuthorBundleMock,
} = vi.hoisted(() => ({
    cacheGetMock: vi.fn(),
    cacheSetMock: vi.fn(),
    readManyMock: vi.fn(),
    countItemsGroupedByFieldMock: vi.fn(),
    getAuthorBundleMock: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: cacheGetMock,
        set: cacheSetMock,
    },
}));

vi.mock("@/server/directus/client", () => ({
    readMany: readManyMock,
    countItemsGroupedByField: countItemsGroupedByFieldMock,
    runWithDirectusServiceAccess: async <T>(
        task: () => Promise<T>,
    ): Promise<T> => await task(),
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: getAuthorBundleMock,
}));

function createAuthorMap(authorIds: string[]): Map<string, AuthorBundleItem> {
    return new Map(
        authorIds.map((authorId) => [
            authorId,
            {
                id: authorId,
                name: authorId,
                display_name: authorId,
                username: authorId,
            },
        ]),
    );
}

function createArticle(params: {
    id: string;
    authorId: string;
    createdAt: string;
    updatedAt: string;
}): AppArticle {
    return {
        id: params.id,
        short_id: params.id,
        author_id: params.authorId,
        status: "published",
        title: `文章-${params.id}`,
        slug: null,
        summary: "摘要",
        cover_file: null,
        cover_url: null,
        body_markdown: "",
        tags: ["测试"],
        category: "tech",
        is_public: true,
        date_created: params.createdAt,
        date_updated: params.updatedAt,
        allow_comments: true,
    };
}

function createDiary(params: {
    id: string;
    authorId: string;
    createdAt: string;
    updatedAt: string;
}): AppDiary {
    return {
        id: params.id,
        short_id: params.id,
        author_id: params.authorId,
        status: "published",
        content: `日记-${params.id}`,
        allow_comments: true,
        praviate: true,
        date_created: params.createdAt,
        date_updated: params.updatedAt,
    };
}

function createDiaryImage(diaryId: string): AppDiaryImage {
    return {
        id: `${diaryId}-image-1`,
        status: "published",
        diary_id: diaryId,
        file_id: `${diaryId}-file-1`,
        image_url: null,
        caption: null,
        is_public: true,
        show_on_profile: true,
        sort: 1,
        date_created: "2026-02-19T08:00:00.000Z",
        date_updated: "2026-02-19T08:00:00.000Z",
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    cacheGetMock.mockResolvedValue(null);
    cacheSetMock.mockResolvedValue(undefined);
    countItemsGroupedByFieldMock.mockResolvedValue(new Map());
});

describe("buildMixedFeed", () => {
    it("会按最近修改时间对文章和日记做统一聚合排序", async () => {
        const articles = [
            createArticle({
                id: "article-1",
                authorId: "author-a",
                createdAt: "2026-02-18T08:00:00.000Z",
                updatedAt: "2026-02-19T12:00:00.000Z",
            }),
            createArticle({
                id: "article-2",
                authorId: "author-b",
                createdAt: "2026-02-18T09:00:00.000Z",
                updatedAt: "2026-02-19T09:00:00.000Z",
            }),
        ];
        const diaries = [
            createDiary({
                id: "diary-1",
                authorId: "author-c",
                createdAt: "2026-02-18T10:00:00.000Z",
                updatedAt: "2026-02-19T11:00:00.000Z",
            }),
            createDiary({
                id: "diary-2",
                authorId: "author-d",
                createdAt: "2026-02-18T11:00:00.000Z",
                updatedAt: "2026-02-19T10:00:00.000Z",
            }),
        ];

        readManyMock.mockImplementation(async (collection: string) => {
            if (collection === "app_articles") {
                return articles;
            }
            if (collection === "app_diaries") {
                return diaries;
            }
            if (collection === "app_diary_images") {
                return diaries.map((diary) => createDiaryImage(diary.id));
            }
            return [];
        });
        getAuthorBundleMock.mockResolvedValue(
            createAuthorMap(["author-a", "author-b", "author-c", "author-d"]),
        );

        const result = await buildMixedFeed({ limit: 10 });

        expect(result.items.map((item) => item.id)).toEqual([
            "article-1",
            "diary-1",
            "diary-2",
            "article-2",
        ]);
        expect(result.items[0]).not.toHaveProperty("score");
        expect(result.items[0]).not.toHaveProperty("signals");
        expect(result.items[0]).not.toHaveProperty("qualityScore");
        expect(result.items[0]).not.toHaveProperty("personalizationScore");
    });

    it("同修改时间下会先按创建时间，再按 type + id 稳定排序", async () => {
        const articles = [
            createArticle({
                id: "article-a",
                authorId: "author-a",
                createdAt: "2026-02-19T09:00:00.000Z",
                updatedAt: "2026-02-19T12:00:00.000Z",
            }),
            createArticle({
                id: "article-z",
                authorId: "author-b",
                createdAt: "2026-02-19T08:00:00.000Z",
                updatedAt: "2026-02-19T12:00:00.000Z",
            }),
        ];
        const diaries = [
            createDiary({
                id: "diary-a",
                authorId: "author-c",
                createdAt: "2026-02-19T08:00:00.000Z",
                updatedAt: "2026-02-19T12:00:00.000Z",
            }),
        ];

        readManyMock.mockImplementation(async (collection: string) => {
            if (collection === "app_articles") {
                return articles;
            }
            if (collection === "app_diaries") {
                return diaries;
            }
            if (collection === "app_diary_images") {
                return diaries.map((diary) => createDiaryImage(diary.id));
            }
            return [];
        });
        getAuthorBundleMock.mockResolvedValue(
            createAuthorMap(["author-a", "author-b", "author-c"]),
        );

        const result = await buildMixedFeed({ limit: 10 });

        expect(result.items.map((item) => item.id)).toEqual([
            "article-a",
            "article-z",
            "diary-a",
        ]);
    });
});
