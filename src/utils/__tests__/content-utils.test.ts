import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockArticle } from "@/__tests__/helpers/mock-data";
import {
    excludeSpecialArticleSlugFilter,
    filterPublicStatus,
} from "@/server/api/v1/shared";

const { readManyMock } = vi.hoisted(() => ({
    readManyMock: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    readMany: readManyMock,
}));

vi.mock("@/server/directus-auth", () => ({
    buildDirectusAssetUrl: vi.fn(
        (fileId: string) => `/api/v1/assets/${fileId}`,
    ),
    buildPublicAssetUrl: vi.fn(
        (fileId: string) => `/api/v1/public/assets/${fileId}`,
    ),
}));

import {
    buildVisiblePostsFilter,
    resolveArticleDisplayTitle,
} from "@/utils/content-utils";

describe("content-utils article display", () => {
    it("空标题草稿展示为新建文章", () => {
        expect(
            resolveArticleDisplayTitle(
                mockArticle({
                    status: "draft",
                    title: "",
                    slug: null,
                }),
            ),
        ).toBe("新建文章");
    });

    it("已发布文章仍优先使用 slug 或 id 回退", () => {
        expect(
            resolveArticleDisplayTitle(
                mockArticle({
                    status: "published",
                    title: "",
                    slug: "published-slug",
                }),
            ),
        ).toBe("published-slug");
    });
});

describe("content-utils visible posts filter", () => {
    it("游客仅返回公开已发布文章", () => {
        expect(buildVisiblePostsFilter(null)).toEqual({
            _and: [filterPublicStatus(), excludeSpecialArticleSlugFilter()],
        });
    });

    it("owner 返回公开文章与自己的 draft", () => {
        expect(buildVisiblePostsFilter("user-1")).toEqual({
            _or: [
                {
                    _and: [
                        filterPublicStatus(),
                        excludeSpecialArticleSlugFilter(),
                    ],
                },
                {
                    _and: [
                        { author_id: { _eq: "user-1" } },
                        { status: { _eq: "draft" } },
                        excludeSpecialArticleSlugFilter(),
                    ],
                },
            ],
        });
    });
});

describe("content-utils derived blog data", () => {
    beforeEach(() => {
        vi.resetModules();
        readManyMock.mockReset();
        readManyMock.mockImplementation(async (collection: string) => {
            if (collection === "app_articles") {
                return [
                    {
                        id: "article-1",
                        short_id: "post-1",
                        author_id: "user-1",
                        title: "Hello",
                        slug: "hello",
                        summary: "Summary",
                        body_markdown: "Body",
                        category: "General",
                        tags: ["astro", "directus"],
                        status: "published",
                        is_public: true,
                        date_created: "2026-03-10T00:00:00.000Z",
                        date_updated: "2026-03-11T00:00:00.000Z",
                        cover_file: null,
                        cover_url: null,
                    },
                ];
            }
            if (collection === "app_user_profiles") {
                return [
                    {
                        user_id: "user-1",
                        username: "alice",
                        display_name: "Alice",
                    },
                ];
            }
            if (collection === "directus_users") {
                return [
                    {
                        id: "user-1",
                        email: "alice@example.com",
                        first_name: "Alice",
                        last_name: "",
                        avatar: null,
                    },
                ];
            }
            if (collection === "app_article_comments") {
                return [{ article_id: "article-1" }];
            }
            if (collection === "app_article_likes") {
                return [{ article_id: "article-1" }];
            }
            return [];
        });
    });

    it("同一波 posts/tags/categories 调用只执行一次文章全集加载", async () => {
        const { getCategoryList, getSortedPosts, getTagList } =
            await import("@/utils/content-utils");

        const posts = await getSortedPosts();
        const tags = await getTagList();
        const categories = await getCategoryList();

        expect(posts).toHaveLength(1);
        expect(tags).toEqual([
            { name: "astro", count: 1 },
            { name: "directus", count: 1 },
        ]);
        expect(categories).toEqual([
            { name: "General", count: 1, url: "/posts?category=General" },
        ]);
        expect(
            readManyMock.mock.calls.filter(
                ([collection]) => collection === "app_articles",
            ),
        ).toHaveLength(1);
        expect(readManyMock).toHaveBeenCalledTimes(5);
    });
});
