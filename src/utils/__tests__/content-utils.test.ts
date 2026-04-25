import { describe, expect, it, vi } from "vitest";

import { mockArticle } from "@/__tests__/helpers/mock-data";
import { filterPublicStatus } from "@/server/api/v1/shared/auth";
import { excludeSpecialArticleSlugFilter } from "@/server/api/v1/shared/helpers";

const { readManyMock } = vi.hoisted(() => ({
    readManyMock: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    readMany: readManyMock,
    runWithDirectusServiceAccess: vi.fn((task: () => unknown) => task()),
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
