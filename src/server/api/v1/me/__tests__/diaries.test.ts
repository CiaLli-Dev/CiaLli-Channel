import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import { DIARY_FIELDS } from "@/server/api/v1/shared";

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    deleteOne: vi.fn(),
    readMany: vi.fn(),
    readOneById: vi.fn(),
    updateOne: vi.fn(),
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

vi.mock("@/server/api/v1/me/_helpers", () => ({
    bindFileOwnerToUser: vi.fn().mockResolvedValue(undefined),
    renderMeMarkdownPreview: vi.fn().mockResolvedValue("<p>preview</p>"),
    syncMarkdownFilesToVisibility: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    cleanupOwnedOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
    collectDiaryCommentCleanupCandidates: vi.fn().mockResolvedValue({
        candidateFileIds: [],
        ownerUserIds: [],
    }),
    collectDiaryFileIds: vi.fn().mockResolvedValue([]),
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
    normalizeDirectusFileId: vi.fn((value: unknown) =>
        typeof value === "string" ? value : null,
    ),
}));

import { createOne, readMany, updateOne } from "@/server/directus/client";
import { createWithShortId } from "@/server/utils/short-id";
import { handleMeDiaries } from "@/server/api/v1/me/diaries";

const mockedCreateOne = vi.mocked(createOne);
const mockedCreateWithShortId = vi.mocked(createWithShortId);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);

function makeDiary(overrides: Record<string, unknown> = {}) {
    return {
        id: "diary-1",
        short_id: "d-1",
        author_id: "user-1",
        status: "draft",
        content: "",
        allow_comments: true,
        praviate: true,
        date_created: "2026-01-01T00:00:00.000Z",
        date_updated: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("GET /me/diaries/working-draft", () => {
    it("无工作草稿时返回 null 和空图片列表", async () => {
        mockedReadMany.mockResolvedValue([] as never);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/diaries/working-draft",
        });

        const response = await handleMeDiaries(
            ctx as unknown as APIContext,
            createMemberAccess(),
            ["diaries", "working-draft"],
        );

        expect(response.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            item: null;
            images: unknown[];
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.item).toBeNull();
        expect(body.images).toEqual([]);
    });

    it("有工作草稿时返回草稿和图片顺序", async () => {
        mockedReadMany
            .mockResolvedValueOnce([makeDiary()] as never)
            .mockResolvedValueOnce([
                { id: "image-1", diary_id: "diary-1", sort: 0 },
            ] as never);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/diaries/working-draft",
        });

        const response = await handleMeDiaries(
            ctx as unknown as APIContext,
            createMemberAccess(),
            ["diaries", "working-draft"],
        );

        expect(response.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            item: { id: string };
            images: Array<{ id: string }>;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.item.id).toBe("diary-1");
        expect(body.images[0]?.id).toBe("image-1");
    });
});

describe("PUT /me/diaries/working-draft", () => {
    it("无工作草稿时创建 draft", async () => {
        mockedReadMany
            .mockResolvedValueOnce([] as never)
            .mockResolvedValueOnce([] as never);
        mockedCreateWithShortId.mockResolvedValue(
            makeDiary({ id: "draft-1", short_id: "draft-1" }) as never,
        );

        const ctx = createMockAPIContext({
            method: "PUT",
            url: "http://localhost:4321/api/v1/me/diaries/working-draft",
            body: {
                content: "",
                praviate: true,
            },
        });

        const response = await handleMeDiaries(
            ctx as unknown as APIContext,
            createMemberAccess(),
            ["diaries", "working-draft"],
        );

        expect(response.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            item: { status: string };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.item.status).toBe("draft");

        const createFn = mockedCreateWithShortId.mock.calls[0]?.[2];
        expect(typeof createFn).toBe("function");
        if (createFn) {
            await createFn("app_diaries", { content: "" });
            expect(mockedCreateOne).toHaveBeenCalledWith(
                "app_diaries",
                { content: "" },
                { fields: [...DIARY_FIELDS] },
            );
        }
    });

    it("已有工作草稿时覆盖当前 draft", async () => {
        mockedReadMany
            .mockResolvedValueOnce([makeDiary({ id: "draft-1" })] as never)
            .mockResolvedValueOnce([] as never);
        mockedUpdateOne.mockResolvedValue(
            makeDiary({
                id: "draft-1",
                content: "draft content",
            }) as never,
        );

        const ctx = createMockAPIContext({
            method: "PUT",
            url: "http://localhost:4321/api/v1/me/diaries/working-draft",
            body: {
                content: "draft content",
                praviate: false,
            },
        });

        const response = await handleMeDiaries(
            ctx as unknown as APIContext,
            createMemberAccess(),
            ["diaries", "working-draft"],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_diaries",
            "draft-1",
            {
                content: "draft content",
                praviate: false,
                status: "draft",
            },
            { fields: [...DIARY_FIELDS] },
        );
    });
});

describe("PATCH /me/diaries/:id", () => {
    it("支持将 draft 发布为 published", async () => {
        mockedReadMany
            .mockResolvedValueOnce([
                makeDiary({ id: "draft-1", content: "ready" }),
            ] as never)
            .mockResolvedValueOnce([] as never);
        mockedUpdateOne.mockResolvedValue(
            makeDiary({
                id: "draft-1",
                status: "published",
                content: "ready",
            }) as never,
        );

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/diaries/draft-1",
            body: {
                status: "published",
            },
        });

        const response = await handleMeDiaries(
            ctx as unknown as APIContext,
            createMemberAccess(),
            ["diaries", "draft-1"],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_diaries",
            "draft-1",
            { status: "published" },
            { fields: [...DIARY_FIELDS] },
        );
    });
});
