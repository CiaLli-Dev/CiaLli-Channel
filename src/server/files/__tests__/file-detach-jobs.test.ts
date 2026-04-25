import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    collectReferencedDirectusFileIds: vi.fn(),
    createOne: vi.fn(),
    deleteOwnerReferences: vi.fn(),
    isResourceReferenceSyncJobSource: vi.fn(),
    markResourceReferenceSyncJobSucceeded: vi.fn(),
    markFilesDetached: vi.fn(),
    parseResourceReferenceSyncJobPayload: vi.fn(),
    readMany: vi.fn(),
    readOneById: vi.fn(),
    replayResourceReferenceSyncJob: vi.fn(),
    seedFileReferencesWhenEmpty: vi.fn(),
    updateMany: vi.fn(),
    updateOne: vi.fn(),
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/directus/client", () => ({
    createOne: mocks.createOne,
    readMany: mocks.readMany,
    readOneById: mocks.readOneById,
    updateMany: mocks.updateMany,
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

vi.mock("@/server/repositories/files/file-reference.repository", () => ({
    deleteOwnerReferences: mocks.deleteOwnerReferences,
}));

vi.mock("@/server/files/file-reference-shadow", () => ({
    seedFileReferencesWhenEmpty: mocks.seedFileReferencesWhenEmpty,
}));

vi.mock("@/server/files/resource-lifecycle", () => ({
    isResourceReferenceSyncJobSource: mocks.isResourceReferenceSyncJobSource,
    markResourceReferenceSyncJobSucceeded:
        mocks.markResourceReferenceSyncJobSucceeded,
    parseResourceReferenceSyncJobPayload:
        mocks.parseResourceReferenceSyncJobPayload,
    replayResourceReferenceSyncJob: mocks.replayResourceReferenceSyncJob,
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

function mockPendingJobClaim(job: Record<string, unknown>, attempts = 1): void {
    mocks.readMany.mockResolvedValueOnce([job]);
    mocks.updateMany.mockResolvedValueOnce([
        {
            ...job,
            status: "processing",
            attempts,
            leased_until: "2026-04-24T00:05:00.000Z",
        },
    ]);
}

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
    mocks.isResourceReferenceSyncJobSource.mockReturnValue(false);
    mocks.deleteOwnerReferences.mockResolvedValue(0);
    mocks.markResourceReferenceSyncJobSucceeded.mockResolvedValue(undefined);
    mocks.markFilesDetached.mockResolvedValue(undefined);
    mocks.parseResourceReferenceSyncJobPayload.mockReturnValue(null);
    mocks.replayResourceReferenceSyncJob.mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        currentFileIds: [],
    });
    mocks.seedFileReferencesWhenEmpty.mockResolvedValue(0);
    mocks.readMany.mockResolvedValue([]);
    mocks.readOneById.mockResolvedValue(null);
    mocks.updateMany.mockResolvedValue([]);
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
    mockPendingJobClaim({
        id: "job-1",
        status: "pending",
        attempts: 0,
        candidate_file_ids: [FILE_ONE, FILE_TWO],
        scheduled_at: "2026-04-24T00:00:00.000Z",
        leased_until: null,
    });
    mocks.collectReferencedDirectusFileIds.mockResolvedValue(
        new Set([FILE_ONE]),
    );

    const result = await runFileDetachJob(
        "job-1",
        new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(mocks.updateMany).toHaveBeenCalledWith(
        "app_file_detach_jobs",
        {
            filter: {
                _and: [
                    { id: { _eq: "job-1" } },
                    { attempts: { _eq: 0 } },
                    { status: { _eq: "pending" } },
                    {
                        _or: [
                            { scheduled_at: { _null: true } },
                            {
                                scheduled_at: {
                                    _lte: "2026-04-24T00:00:00.000Z",
                                },
                            },
                        ],
                    },
                ],
            },
            limit: 1,
        },
        expect.objectContaining({
            status: "processing",
            attempts: 1,
            leased_until: "2026-04-24T00:05:00.000Z",
        }),
        { fields: ["id"] },
    );
    expect(mocks.markFilesDetached).toHaveBeenCalledWith(
        [FILE_TWO],
        "2026-04-24T00:00:00.000Z",
    );
    expect(mocks.seedFileReferencesWhenEmpty).toHaveBeenCalledTimes(1);
    expect(mocks.updateOne).toHaveBeenCalledWith(
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

it("skips detach job processing when the atomic claim loses the race", async () => {
    mocks.readMany.mockResolvedValueOnce([
        {
            id: "job-raced",
            status: "pending",
            attempts: 0,
            candidate_file_ids: [FILE_TWO],
            scheduled_at: "2026-04-24T00:00:00.000Z",
            leased_until: null,
        },
    ]);
    mocks.updateMany.mockResolvedValueOnce([]);

    const result = await runFileDetachJob(
        "job-raced",
        new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(mocks.markFilesDetached).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(result).toEqual({
        status: "skipped",
        jobId: "job-raced",
        detached: 0,
        skippedReferenced: 0,
    });
});

it("keeps failed detach jobs pending with a retry schedule", async () => {
    mockPendingJobClaim(
        {
            id: "job-1",
            status: "pending",
            attempts: 1,
            candidate_file_ids: [FILE_TWO],
            scheduled_at: "2026-04-24T00:00:00.000Z",
            leased_until: null,
        },
        2,
    );
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

it("reschedules pending jobs when the source record still exists", async () => {
    mockPendingJobClaim({
        id: "job-1",
        status: "pending",
        source_type: "me.article.delete",
        source_id: "article-1",
        attempts: 0,
        candidate_file_ids: [FILE_TWO],
        scheduled_at: "2026-04-24T00:00:00.000Z",
        leased_until: null,
    });
    mocks.readOneById.mockResolvedValue({ id: "article-1" });

    const result = await runFileDetachJob(
        "job-1",
        new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(mocks.readOneById).toHaveBeenCalledWith(
        "app_articles",
        "article-1",
        { fields: ["id"] },
    );
    expect(mocks.markFilesDetached).not.toHaveBeenCalled();
    expect(mocks.updateOne).toHaveBeenCalledWith(
        "app_file_detach_jobs",
        "job-1",
        expect.objectContaining({
            status: "pending",
            scheduled_at: "2026-04-24T00:00:30.000Z",
            error_code: "SOURCE_NOT_DELETED",
        }),
    );
    expect(result).toEqual({
        status: "pending",
        jobId: "job-1",
        detached: 0,
        skippedReferenced: 0,
    });
});

it("does not block legacy jobs with unknown source types", async () => {
    mockPendingJobClaim({
        id: "job-legacy",
        status: "pending",
        source_type: "legacy.delete",
        source_id: "source-1",
        attempts: 0,
        candidate_file_ids: [FILE_TWO],
        scheduled_at: "2026-04-24T00:00:00.000Z",
        leased_until: null,
    });

    const result = await runFileDetachJob(
        "job-legacy",
        new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(mocks.readOneById).not.toHaveBeenCalled();
    expect(mocks.markFilesDetached).toHaveBeenCalledWith(
        [FILE_TWO],
        "2026-04-24T00:00:00.000Z",
    );
    expect(result.status).toBe("succeeded");
});

it("deletes owner references only after a resource owner release source is gone", async () => {
    mockPendingJobClaim({
        id: "job-release",
        status: "pending",
        source_type: "resource.owner.release:app_articles",
        source_id: "article-1",
        attempts: 0,
        candidate_file_ids: [FILE_TWO],
        scheduled_at: "2026-04-24T00:00:00.000Z",
        leased_until: null,
    });

    const result = await runFileDetachJob(
        "job-release",
        new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(mocks.readOneById).toHaveBeenCalledWith(
        "app_articles",
        "article-1",
        { fields: ["id"] },
    );
    expect(mocks.deleteOwnerReferences).toHaveBeenCalledWith({
        ownerCollection: "app_articles",
        ownerId: "article-1",
    });
    expect(mocks.markFilesDetached).toHaveBeenCalledWith(
        [FILE_TWO],
        "2026-04-24T00:00:00.000Z",
    );
    expect(result.status).toBe("succeeded");
});

it("keeps unknown owner release source types pending", async () => {
    mockPendingJobClaim({
        id: "job-release-unknown",
        status: "pending",
        source_type: "resource.owner.release:app_unknown",
        source_id: "source-1",
        attempts: 0,
        candidate_file_ids: [FILE_TWO],
        scheduled_at: "2026-04-24T00:00:00.000Z",
        leased_until: null,
    });

    const result = await runFileDetachJob(
        "job-release-unknown",
        new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(mocks.readOneById).not.toHaveBeenCalled();
    expect(mocks.deleteOwnerReferences).not.toHaveBeenCalled();
    expect(mocks.markFilesDetached).not.toHaveBeenCalled();
    expect(mocks.updateOne).toHaveBeenLastCalledWith(
        "app_file_detach_jobs",
        "job-release-unknown",
        expect.objectContaining({
            status: "pending",
            error_code: "SOURCE_NOT_DELETED",
        }),
    );
    expect(result.status).toBe("pending");
});

it("replays resource reference sync jobs instead of detaching files", async () => {
    const payload = {
        ownerCollection: "app_articles",
        ownerId: "article-1",
        ownerUserId: "user-1",
        visibility: "public",
        references: [
            {
                ownerField: "body_markdown",
                referenceKind: "markdown_asset",
                fileIds: [FILE_TWO],
            },
        ],
    };
    mockPendingJobClaim({
        id: "job-sync",
        status: "pending",
        source_type: "resource.references.sync",
        source_id: "article-1",
        attempts: 0,
        candidate_file_ids: payload,
        scheduled_at: "2026-04-24T00:00:00.000Z",
        leased_until: null,
    });
    mocks.isResourceReferenceSyncJobSource.mockReturnValue(true);
    mocks.parseResourceReferenceSyncJobPayload.mockReturnValue(payload);

    const result = await runFileDetachJob(
        "job-sync",
        new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(mocks.replayResourceReferenceSyncJob).toHaveBeenCalledWith(payload);
    expect(mocks.markResourceReferenceSyncJobSucceeded).toHaveBeenCalledWith({
        jobId: "job-sync",
        nowIso: "2026-04-24T00:00:00.000Z",
    });
    expect(mocks.markFilesDetached).not.toHaveBeenCalled();
    expect(result).toEqual({
        status: "succeeded",
        jobId: "job-sync",
        detached: 0,
        skippedReferenced: 0,
    });
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
