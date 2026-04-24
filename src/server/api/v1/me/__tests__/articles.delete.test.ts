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
    deleteDirectusFile: vi.fn(),
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
    collectArticleCommentCleanupCandidates: vi.fn().mockResolvedValue({
        candidateFileIds: [],
        ownerUserIds: [],
    }),
    normalizeDirectusFileId: vi.fn((value: unknown) => {
        if (!value) {
            return null;
        }
        return typeof value === "string" ? value || null : null;
    }),
    extractDirectusAssetIdsFromMarkdown: vi.fn(() => []),
    mergeDirectusFileCleanupCandidates: vi.fn(
        (
            ...groups: Array<{
                candidateFileIds: string[];
                ownerUserIds: string[];
            }>
        ) => ({
            candidateFileIds: groups.flatMap((group) => group.candidateFileIds),
            ownerUserIds: groups.flatMap((group) => group.ownerUserIds),
        }),
    ),
}));

vi.mock("@/server/api/v1/me/_helpers", () => ({
    detachManagedFiles: vi.fn().mockResolvedValue([]),
    renderMeMarkdownPreview: vi.fn().mockResolvedValue("<p>preview</p>"),
    bindFileOwnerToUser: vi.fn().mockResolvedValue(undefined),
    syncManagedFileBinding: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
    syncMarkdownFileLifecycle: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
    syncMarkdownFilesToVisibility: vi.fn().mockResolvedValue([]),
}));

import {
    deleteDirectusFile,
    deleteOne,
    readMany,
} from "@/server/directus/client";
import { extractDirectusAssetIdsFromMarkdown } from "@/server/api/v1/shared/file-cleanup";
import { handleMeArticles } from "@/server/api/v1/me/articles";

const mockedDeleteDirectusFile = vi.mocked(deleteDirectusFile);
const mockedDeleteOne = vi.mocked(deleteOne);
const mockedReadMany = vi.mocked(readMany);
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
        expect(mockedDeleteDirectusFile).not.toHaveBeenCalled();
    });

    it("删除时不会同步触发文件补偿清理", async () => {
        const articleFileId = "11111111-2222-3333-9444-555555555555";
        mockedReadMany.mockResolvedValue([
            mockArticle({
                id: "article-1",
                author_id: "user-1",
                body_markdown: `![article](/api/v1/public/assets/${articleFileId})`,
            }),
        ]);
        mockedDeleteOne.mockResolvedValue(undefined as never);
        mockedExtractDirectusAssetIdsFromMarkdown.mockReturnValue([
            articleFileId,
        ]);

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
        expect(mockedDeleteDirectusFile).not.toHaveBeenCalled();
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
