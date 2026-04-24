import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    collectReferencedDirectusFileIds: vi.fn(),
    createOne: vi.fn(),
    markFilesDetached: vi.fn(),
    readMany: vi.fn(),
    updateOne: vi.fn(),
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/directus/client", () => ({
    createOne: mocks.createOne,
    readMany: mocks.readMany,
    updateOne: mocks.updateOne,
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    collectReferencedDirectusFileIds: mocks.collectReferencedDirectusFileIds,
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: mocks.withServiceRepositoryContext,
}));

vi.mock("@/server/repositories/files/file-lifecycle.repository", () => ({
    markFilesDetached: mocks.markFilesDetached,
}));

import {
    enqueueFileDetachJob,
    readFileDetachJobBatchSize,
    readFileDetachJobIntervalMs,
    readFileDetachJobLeaseSeconds,
    recoverStuckFileDetachJobs,
    runFileDetachJob,
} from "@/server/files/file-detach-jobs";

const FILE_ONE = "11111111-1111-4111-8111-111111111111";
const FILE_TWO = "22222222-2222-4222-8222-222222222222";

describe("file-detach-jobs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.FILE_DETACH_JOB_INTERVAL_MS;
        delete process.env.FILE_DETACH_JOB_BATCH_SIZE;
        delete process.env.FILE_DETACH_JOB_LEASE_SECONDS;
        mocks.collectReferencedDirectusFileIds.mockResolvedValue(new Set());
        mocks.createOne.mockResolvedValue({
            id: "job-1",
            status: "pending",
            candidate_file_ids: [],
        });
        mocks.markFilesDetached.mockResolvedValue(undefined);
        mocks.readMany.mockResolvedValue([]);
        mocks.updateOne.mockResolvedValue({});
    });

    it("uses file detach env defaults when variables are absent", () => {
        expect(readFileDetachJobIntervalMs()).toBe(60_000);
        expect(readFileDetachJobBatchSize()).toBe(50);
        expect(readFileDetachJobLeaseSeconds()).toBe(300);
    });

    it("enqueues normalized unique candidate file ids before deletion", async () => {
        const result = await enqueueFileDetachJob({
            sourceType: "me.article.delete",
            sourceId: "article-1",
            fileValues: [FILE_ONE, FILE_ONE, "not-a-file-id", FILE_TWO],
            scheduledAt: "2026-04-24T00:00:00.000Z",
        });

        expect(mocks.createOne).toHaveBeenCalledWith(
            "app_file_detach_jobs",
            expect.objectContaining({
                status: "pending",
                source_type: "me.article.delete",
                source_id: "article-1",
                candidate_file_ids: [FILE_ONE, FILE_TWO],
                scheduled_at: "2026-04-24T00:00:00.000Z",
            }),
            { fields: ["id", "status", "candidate_file_ids"] },
        );
        expect(result).toEqual({
            jobId: "job-1",
            status: "pending",
            candidateFileIds: [FILE_ONE, FILE_TWO],
        });
    });

    it("creates a skipped outbox row for empty candidate sets", async () => {
        mocks.createOne.mockResolvedValue({
            id: "job-empty",
            status: "skipped",
            candidate_file_ids: [],
        });

        const result = await enqueueFileDetachJob({
            sourceType: "comment.article.delete",
            sourceId: "comment-1",
            fileValues: [],
            scheduledAt: "2026-04-24T00:00:00.000Z",
        });

        expect(mocks.createOne).toHaveBeenCalledWith(
            "app_file_detach_jobs",
            expect.objectContaining({
                status: "skipped",
                candidate_file_ids: [],
                scheduled_at: null,
                finished_at: "2026-04-24T00:00:00.000Z",
            }),
            { fields: ["id", "status", "candidate_file_ids"] },
        );
        expect(result).toEqual({
            jobId: "job-empty",
            status: "skipped",
            candidateFileIds: [],
        });
    });

    it("detaches only currently unreferenced candidate files", async () => {
        mocks.readMany.mockResolvedValue([
            {
                id: "job-1",
                status: "pending",
                attempts: 0,
                candidate_file_ids: [FILE_ONE, FILE_TWO],
                scheduled_at: "2026-04-24T00:00:00.000Z",
                leased_until: null,
            },
        ]);
        mocks.collectReferencedDirectusFileIds.mockResolvedValue(
            new Set([FILE_ONE]),
        );

        const result = await runFileDetachJob(
            "job-1",
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(mocks.markFilesDetached).toHaveBeenCalledWith(
            [FILE_TWO],
            "2026-04-24T00:00:00.000Z",
        );
        expect(mocks.updateOne).toHaveBeenNthCalledWith(
            2,
            "app_file_detach_jobs",
            "job-1",
            expect.objectContaining({
                status: "succeeded",
                detached_file_ids: [FILE_TWO],
                skipped_referenced_file_ids: [FILE_ONE],
            }),
        );
        expect(result).toEqual({
            status: "succeeded",
            jobId: "job-1",
            detached: 1,
            skippedReferenced: 1,
        });
    });

    it("keeps failed detach jobs pending with a retry schedule", async () => {
        mocks.readMany.mockResolvedValue([
            {
                id: "job-1",
                status: "pending",
                attempts: 1,
                candidate_file_ids: [FILE_TWO],
                scheduled_at: "2026-04-24T00:00:00.000Z",
                leased_until: null,
            },
        ]);
        mocks.markFilesDetached.mockRejectedValue(new Error("network timeout"));

        const result = await runFileDetachJob(
            "job-1",
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(mocks.updateOne).toHaveBeenLastCalledWith(
            "app_file_detach_jobs",
            "job-1",
            expect.objectContaining({
                status: "pending",
                scheduled_at: "2026-04-24T00:01:00.000Z",
                leased_until: null,
                error_code: "DIRECTUS_NETWORK",
                error_message: "network timeout",
            }),
        );
        expect(result.status).toBe("pending");
    });

    it("recovers processing jobs with expired leases", async () => {
        mocks.readMany.mockResolvedValue([{ id: "job-stuck" }]);

        const recovered = await recoverStuckFileDetachJobs(
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(recovered).toBe(1);
        expect(mocks.updateOne).toHaveBeenCalledWith(
            "app_file_detach_jobs",
            "job-stuck",
            expect.objectContaining({
                status: "pending",
                scheduled_at: "2026-04-24T00:00:00.000Z",
                leased_until: null,
                error_code: "LEASE_EXPIRED",
            }),
        );
    });
});
