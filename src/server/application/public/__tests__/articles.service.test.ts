import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectusPostEntry } from "@/utils/content-utils";

const {
    cacheGetMock,
    cacheSetMock,
    countItemsMock,
    countItemsGroupedByFieldMock,
    readManyMock,
    getAuthorBundleMock,
    loadProfileByUsernameMock,
    readAuthorMock,
} = vi.hoisted(() => ({
    cacheGetMock: vi.fn(),
    cacheSetMock: vi.fn(),
    countItemsMock: vi.fn(),
    countItemsGroupedByFieldMock: vi.fn(),
    readManyMock: vi.fn(),
    getAuthorBundleMock: vi.fn(),
    loadProfileByUsernameMock: vi.fn(),
    readAuthorMock: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: cacheGetMock,
        set: cacheSetMock,
    },
}));

vi.mock("@/server/directus/client", () => ({
    countItems: countItemsMock,
    countItemsGroupedByField: countItemsGroupedByFieldMock,
    readMany: readManyMock,
    runWithDirectusServiceAccess: async <T>(task: () => Promise<T>) =>
        await task(),
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: getAuthorBundleMock,
}));

vi.mock("@/server/api/v1/public/_helpers", () => ({
    loadProfileByUsername: loadProfileByUsernameMock,
    normalizeAuthorHandle: (value: string) =>
        value.trim().replace(/^@+/, "").toLowerCase(),
    readAuthor: readAuthorMock,
}));

import {
    getPublicArticleListData,
    getPublicArticleTaxonomyData,
    parsePublicArticleListInput,
    UNCATEGORIZED_ARTICLE_CATEGORY,
} from "@/server/application/public/articles.service";

describe("public/articles.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cacheGetMock.mockResolvedValue(null);
        cacheSetMock.mockResolvedValue(undefined);
        countItemsMock.mockResolvedValue(0);
        countItemsGroupedByFieldMock.mockResolvedValue(new Map());
        readManyMock.mockResolvedValue([]);
        getAuthorBundleMock.mockResolvedValue(
            new Map([
                [
                    "author-1",
                    {
                        id: "author-1",
                        name: "Alice",
                        display_name: "Alice",
                        username: "alice",
                    },
                ],
            ]),
        );
        loadProfileByUsernameMock.mockResolvedValue(null);
        readAuthorMock.mockReturnValue({
            id: "author-1",
            name: "Alice",
            display_name: "Alice",
            username: "alice",
        });
    });

    it("parsePublicArticleListInput 支持多 tag 与未分类查询", () => {
        const input = parsePublicArticleListInput(
            new URL(
                "http://localhost:4321/posts?page=2&limit=5&tag=astro&tag=directus&uncategorized=1&q=hello",
            ),
            {
                defaultLimit: 5,
                maxLimit: 5,
            },
        );

        expect(input).toEqual({
            page: 2,
            limit: 5,
            tags: ["astro", "directus"],
            category: UNCATEGORIZED_ARTICLE_CATEGORY,
            q: "hello",
            authorHandle: null,
        });
    });

    it("getPublicArticleTaxonomyData 聚合 tag/category 并缓存", async () => {
        readManyMock.mockResolvedValue([
            {
                tags: ["astro", "directus"],
                category: "tech",
            },
            {
                tags: ["astro"],
                category: null,
            },
        ]);

        const result = await getPublicArticleTaxonomyData();

        expect(result.tags).toEqual([
            { name: "astro", count: 2 },
            { name: "directus", count: 1 },
        ]);
        expect(result.categories).toEqual([
            {
                name: "tech",
                count: 1,
                url: "/posts?category=tech",
            },
            {
                name: "uncategorized",
                count: 1,
                url: "/posts?uncategorized=1",
            },
        ]);
        expect(cacheSetMock).toHaveBeenCalledWith(
            "article-taxonomy",
            "public",
            result,
        );
    });

    it("getPublicArticleListData 返回分页卡片数据并写入缓存", async () => {
        readManyMock.mockResolvedValue([
            {
                id: "article-1",
                short_id: "a1",
                author_id: "author-1",
                status: "published",
                title: "Hello",
                slug: "hello",
                summary: "summary",
                cover_file: null,
                cover_url: "https://example.com/cover.jpg",
                tags: ["astro"],
                category: "tech",
                is_public: true,
                date_created: "2026-04-01T00:00:00.000Z",
                date_updated: "2026-04-02T00:00:00.000Z",
            },
        ]);
        countItemsMock.mockResolvedValue(1);
        countItemsGroupedByFieldMock
            .mockResolvedValueOnce(new Map([["article-1", 3]]))
            .mockResolvedValueOnce(new Map([["article-1", 2]]));

        const result = await getPublicArticleListData({
            page: 1,
            limit: 5,
            tags: ["astro"],
            category: null,
            q: null,
            authorHandle: null,
        });

        expect(result.page).toBe(1);
        expect(result.limit).toBe(5);
        expect(result.total).toBe(1);
        expect(result.items).toHaveLength(1);
        expect((result.items[0] as DirectusPostEntry).data).toMatchObject({
            article_id: "article-1",
            title: "Hello",
            like_count: 3,
            comment_count: 2,
            tags: ["astro"],
            category: "tech",
        });
        expect(cacheSetMock).toHaveBeenCalledWith(
            "article-list",
            expect.any(String),
            result,
        );
    });

    it("author 不存在时直接返回空分页", async () => {
        loadProfileByUsernameMock.mockResolvedValue(null);

        const result = await getPublicArticleListData({
            page: 3,
            limit: 5,
            tags: [],
            category: null,
            q: null,
            authorHandle: "missing-user",
        });

        expect(result).toEqual({
            items: [],
            page: 3,
            limit: 5,
            total: 0,
        });
        expect(readManyMock).not.toHaveBeenCalled();
    });
});
