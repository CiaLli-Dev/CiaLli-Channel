import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import { mockArticle } from "@/__tests__/helpers/mock-data";

vi.mock("@/server/directus/client", () => ({
    readMany: vi.fn(),
    createOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    updateDirectusFileMetadata: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        invalidate: vi.fn(),
        invalidateByDomain: vi.fn(),
    },
}));

vi.mock("@/server/utils/short-id", () => ({
    createWithShortId: vi.fn(),
}));

vi.mock("@/server/markdown/render", () => ({
    renderMarkdown: vi.fn().mockResolvedValue("<p>preview</p>"),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    normalizeDirectusFileId: vi.fn((value: unknown) => {
        if (!value) {
            return null;
        }
        return typeof value === "string" ? value || null : null;
    }),
    extractDirectusAssetIdsFromMarkdown: vi.fn(() => []),
    cleanupOwnedOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
}));

import { deleteOne, readMany } from "@/server/directus/client";
import {
    cleanupOwnedOrphanDirectusFiles,
    extractDirectusAssetIdsFromMarkdown,
} from "@/server/api/v1/shared/file-cleanup";
import { handleMeArticles } from "@/server/api/v1/me/articles";

const mockedDeleteOne = vi.mocked(deleteOne);
const mockedReadMany = vi.mocked(readMany);
const mockedCleanupOwnedOrphanDirectusFiles = vi.mocked(
    cleanupOwnedOrphanDirectusFiles,
);
const mockedExtractDirectusAssetIdsFromMarkdown = vi.mocked(
    extractDirectusAssetIdsFromMarkdown,
);

beforeEach(() => {
    vi.clearAllMocks();
});

describe("DELETE /me/articles/:id", () => {
    it("删除成功", async () => {
        const article = mockArticle({ author_id: "user-1", cover_file: null });
        mockedReadMany.mockResolvedValue([article]);
        mockedDeleteOne.mockResolvedValue(undefined as never);

        const ctx = createMockAPIContext({
            method: "DELETE",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            id: string;
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.id).toBe("article-1");
    });

    it("非 owner → 404", async () => {
        mockedReadMany.mockResolvedValue([]);

        const ctx = createMockAPIContext({
            method: "DELETE",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(404);
    });

    it("删除正文时忽略纯文本 UUID", async () => {
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                body_markdown: "victim 6dc1edf9-a1f8-4191-bbe2-0fa6ff02ff69",
            }),
        ]);
        mockedDeleteOne.mockResolvedValue(undefined as never);
        mockedExtractDirectusAssetIdsFromMarkdown.mockReturnValue([]);

        const ctx = createMockAPIContext({
            method: "DELETE",
            url: "http://localhost:4321/api/v1/me/articles/article-1",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "article-1"],
        );

        expect(res.status).toBe(200);
        expect(mockedCleanupOwnedOrphanDirectusFiles).not.toHaveBeenCalled();
    });
});

describe("路由 fallback", () => {
    it("未知路径 → 404", async () => {
        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/articles/a/b/c",
        });
        const access = createMemberAccess();

        const res = await handleMeArticles(
            ctx as unknown as APIContext,
            access,
            ["articles", "a", "b", "c"],
        );

        expect(res.status).toBe(404);
    });
});
