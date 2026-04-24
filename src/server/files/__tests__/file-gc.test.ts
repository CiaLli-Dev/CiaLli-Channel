import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    collectReferencedDirectusFileIds: vi.fn(),
    readStaleFileGcCandidatesFromRepository: vi.fn(),
    deleteOrphanFileFromRepository: vi.fn(),
    reconcileManagedFileLifecycle: vi.fn(),
    readManagedFilesByIds: vi.fn(),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: mocks.withServiceRepositoryContext,
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    collectReferencedDirectusFileIds: mocks.collectReferencedDirectusFileIds,
}));

vi.mock("@/server/repositories/files/file-cleanup.repository", () => ({
    readStaleFileGcCandidatesFromRepository:
        mocks.readStaleFileGcCandidatesFromRepository,
    deleteOrphanFileFromRepository: mocks.deleteOrphanFileFromRepository,
}));

vi.mock("@/server/files/file-lifecycle-reconciliation", () => ({
    reconcileManagedFileLifecycle: mocks.reconcileManagedFileLifecycle,
}));

vi.mock("@/server/repositories/files/file-lifecycle.repository", () => ({
    readManagedFilesByIds: mocks.readManagedFilesByIds,
}));

import {
    readFileGcBatchSize,
    readFileGcIntervalMs,
    readFileGcRetentionHours,
    runFileGcBatch,
} from "@/server/files/file-gc";

describe("file-gc", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.FILE_GC_INTERVAL_MS;
        delete process.env.FILE_GC_RETENTION_HOURS;
        delete process.env.FILE_GC_BATCH_SIZE;
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([]);
        mocks.collectReferencedDirectusFileIds.mockResolvedValue(new Set());
        mocks.deleteOrphanFileFromRepository.mockResolvedValue({
            ok: true,
            fileId: "file-1",
        });
        mocks.reconcileManagedFileLifecycle.mockResolvedValue({
            attached: 0,
            detached: 0,
            temporary: 0,
            protected: 0,
        });
        mocks.readManagedFilesByIds.mockResolvedValue([]);
    });

    it("uses GC env defaults when variables are absent", () => {
        expect(readFileGcIntervalMs()).toBe(900_000);
        expect(readFileGcRetentionHours()).toBe(24);
        expect(readFileGcBatchSize()).toBe(200);
    });

    it("deletes only unreferenced stale candidate files", async () => {
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            {
                id: "file-orphan",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
            {
                id: "file-referenced",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
        ]);
        mocks.readManagedFilesByIds.mockResolvedValue([
            {
                id: "file-orphan",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
            {
                id: "file-referenced",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
        ]);
        mocks.collectReferencedDirectusFileIds.mockResolvedValue(
            new Set(["file-referenced"]),
        );

        const result = await runFileGcBatch(
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(
            mocks.readStaleFileGcCandidatesFromRepository,
        ).toHaveBeenCalledWith({
            detachedBefore: "2026-04-23T00:00:00.000Z",
            limit: 200,
        });
        expect(mocks.deleteOrphanFileFromRepository).toHaveBeenCalledTimes(1);
        expect(mocks.deleteOrphanFileFromRepository).toHaveBeenCalledWith(
            "file-orphan",
        );
        expect(result).toEqual({
            scanned: 2,
            referenced: 1,
            deleted: 1,
            notFound: 0,
            failed: 0,
            skippedState: 0,
            skippedReferenced: 1,
            candidateFileIds: ["file-orphan", "file-referenced"],
            deletedFileIds: ["file-orphan"],
        });
    });

    it("deletes unreferenced stale temporary files", async () => {
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            {
                id: "file-temporary",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
        ]);
        mocks.readManagedFilesByIds.mockResolvedValue([
            {
                id: "file-temporary",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
        ]);

        const result = await runFileGcBatch(
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(mocks.deleteOrphanFileFromRepository).toHaveBeenCalledWith(
            "file-temporary",
        );
        expect(result.deleted).toBe(1);
        expect(result.skippedReferenced).toBe(0);
        expect(result.skippedState).toBe(0);
    });

    it("skips stale temporary files that are referenced", async () => {
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            {
                id: "file-temporary",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
        ]);
        mocks.readManagedFilesByIds.mockResolvedValue([
            {
                id: "file-temporary",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
        ]);
        mocks.collectReferencedDirectusFileIds.mockResolvedValue(
            new Set(["file-temporary"]),
        );

        const result = await runFileGcBatch(
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.deleted).toBe(0);
        expect(result.skippedReferenced).toBe(1);
    });

    it("rechecks references before deleting each orphan", async () => {
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            {
                id: "file-raced",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
        ]);
        mocks.readManagedFilesByIds.mockResolvedValue([
            {
                id: "file-raced",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
        ]);
        mocks.collectReferencedDirectusFileIds
            .mockResolvedValueOnce(new Set())
            .mockResolvedValueOnce(new Set(["file-raced"]));

        const result = await runFileGcBatch(
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(mocks.collectReferencedDirectusFileIds).toHaveBeenCalledTimes(2);
        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.deleted).toBe(0);
        expect(result.skippedReferenced).toBe(1);
    });

    it("rechecks lifecycle state before deleting each orphan", async () => {
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            {
                id: "file-raced",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
        ]);
        mocks.readManagedFilesByIds
            .mockResolvedValueOnce([
                {
                    id: "file-raced",
                    date_created: "2026-04-20T00:00:00.000Z",
                    app_lifecycle: "detached",
                    app_detached_at: "2026-04-20T00:00:00.000Z",
                },
            ])
            .mockResolvedValueOnce([
                {
                    id: "file-raced",
                    date_created: "2026-04-20T00:00:00.000Z",
                    app_lifecycle: "attached",
                    app_detached_at: null,
                },
            ]);

        const result = await runFileGcBatch(
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.deleted).toBe(0);
        expect(result.skippedState).toBe(1);
    });

    it("skips current lifecycle rows that are not GC eligible", async () => {
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            {
                id: "file-attached",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
            {
                id: "file-protected",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-20T00:00:00.000Z",
            },
            {
                id: "file-fresh-temporary",
                date_created: "2026-04-24T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
        ]);
        mocks.readManagedFilesByIds.mockResolvedValue([
            {
                id: "file-attached",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "attached",
                app_detached_at: null,
            },
            {
                id: "file-protected",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "protected",
                app_detached_at: null,
            },
            {
                id: "file-fresh-temporary",
                date_created: "2026-04-24T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
        ]);

        const result = await runFileGcBatch(
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.skippedState).toBe(3);
        expect(result.skippedReferenced).toBe(0);
    });

    it("does not run full lifecycle reconciliation before a GC batch", async () => {
        await runFileGcBatch(new Date("2026-04-24T00:00:00.000Z"));

        expect(mocks.reconcileManagedFileLifecycle).not.toHaveBeenCalled();
    });
});
