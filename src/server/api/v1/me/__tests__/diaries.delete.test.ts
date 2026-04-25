import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    deleteOne: vi.fn(),
    deleteDirectusFile: vi.fn(),
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

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    collectDiaryCommentCleanupCandidates: vi.fn().mockResolvedValue({
        candidateFileIds: ["comment-file"],
        ownerUserIds: ["comment-user"],
    }),
    collectDiaryFileIds: vi.fn().mockResolvedValue(["image-file"]),
    extractDirectusAssetIdsFromMarkdown: vi.fn(() => ["content-file"]),
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

vi.mock("@/server/files/file-detach-jobs", () => ({
    enqueueFileDetachJob: vi.fn().mockResolvedValue({
        jobId: "detach-job-1",
        status: "pending",
        candidateFileIds: [],
    }),
}));

import {
    deleteDirectusFile,
    deleteOne,
    readMany,
} from "@/server/directus/client";
import { enqueueFileDetachJob } from "@/server/files/file-detach-jobs";
import { handleMeDiaries } from "@/server/api/v1/me/diaries";

const mockedDeleteDirectusFile = vi.mocked(deleteDirectusFile);
const mockedDeleteOne = vi.mocked(deleteOne);
const mockedReadMany = vi.mocked(readMany);
const mockedEnqueueFileDetachJob = vi.mocked(enqueueFileDetachJob);

function makeDiary(overrides: Record<string, unknown> = {}) {
    return {
        id: "diary-1",
        short_id: "d-1",
        author_id: "user-1",
        status: "published",
        content: "diary content",
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

describe("DELETE /me/diaries/:id", () => {
    it("删除时会合并正文、图片与关联评论中的资源候选", async () => {
        mockedReadMany.mockResolvedValue([makeDiary()] as never);
        mockedDeleteOne.mockResolvedValue(undefined as never);

        const ctx = createMockAPIContext({
            method: "DELETE",
            url: "http://localhost:4321/api/v1/me/diaries/diary-1",
        });
        const access = createMemberAccess();

        const response = await handleMeDiaries(
            ctx as unknown as APIContext,
            access,
            ["diaries", "diary-1"],
        );

        expect(response.status).toBe(200);
        expect(mockedEnqueueFileDetachJob).toHaveBeenCalledWith(
            expect.objectContaining({
                fileValues: ["content-file", "image-file", "comment-file"],
            }),
        );
        expect(
            mockedEnqueueFileDetachJob.mock.invocationCallOrder[0],
        ).toBeLessThan(mockedDeleteOne.mock.invocationCallOrder[0] ?? 0);
        expect(mockedDeleteDirectusFile).not.toHaveBeenCalled();
    });
});
