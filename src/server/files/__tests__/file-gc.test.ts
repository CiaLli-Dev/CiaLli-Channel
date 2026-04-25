import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    collectReferencedDirectusFileIds: vi.fn(),
    readStaleFileGcCandidatesFromRepository: vi.fn(),
    deleteOrphanFileFromRepository: vi.fn(),
    markFilesAttached: vi.fn(),
    markFilesDeleted: vi.fn(),
    markFilesQuarantined: vi.fn(),
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

vi.mock("@/server/repositories/files/file-lifecycle.repository", () => ({
    markFilesAttached: mocks.markFilesAttached,
    markFilesDeleted: mocks.markFilesDeleted,
    markFilesQuarantined: mocks.markFilesQuarantined,
    readManagedFilesByIds: mocks.readManagedFilesByIds,
}));

import {
    readFileGcBatchSize,
    readFileGcIntervalMs,
    readFileGcQuarantineDays,
    readFileGcRetentionHours,
    runFileGcBatch,
} from "@/server/files/file-gc";

const NOW = new Date("2026-04-28T00:00:00.000Z");
const DETACHED_BEFORE = "2026-04-21T00:00:00.000Z";
const QUARANTINED_BEFORE = "2026-04-21T00:00:00.000Z";

function resetFileGcMocks(): void {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.FILE_GC_INTERVAL_MS;
    delete process.env.FILE_GC_RETENTION_HOURS;
    delete process.env.FILE_GC_QUARANTINE_DAYS;
    delete process.env.FILE_GC_BATCH_SIZE;
    mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([]);
    mocks.collectReferencedDirectusFileIds.mockResolvedValue(new Set());
    mocks.deleteOrphanFileFromRepository.mockResolvedValue({
        ok: true,
        fileId: "file-1",
    });
    mocks.markFilesAttached.mockResolvedValue(undefined);
    mocks.markFilesDeleted.mockResolvedValue(undefined);
    mocks.markFilesQuarantined.mockResolvedValue(undefined);
    mocks.readManagedFilesByIds.mockResolvedValue([]);
}

function staleDetachedFile(id: string): {
    id: string;
    date_created: string;
    app_lifecycle: "detached";
    app_detached_at: string;
    app_quarantined_at: null;
    app_deleted_at: null;
} {
    return {
        id,
        date_created: "2026-04-20T00:00:00.000Z",
        app_lifecycle: "detached",
        app_detached_at: "2026-04-20T00:00:00.000Z",
        app_quarantined_at: null,
        app_deleted_at: null,
    };
}

function staleQuarantinedFile(id: string): {
    id: string;
    date_created: string;
    app_lifecycle: "quarantined";
    app_detached_at: string;
    app_quarantined_at: string;
    app_deleted_at: null;
} {
    return {
        id,
        date_created: "2026-04-10T00:00:00.000Z",
        app_lifecycle: "quarantined",
        app_detached_at: "2026-04-11T00:00:00.000Z",
        app_quarantined_at: "2026-04-20T00:00:00.000Z",
        app_deleted_at: null,
    };
}

describe("file-gc", () => {
    beforeEach(() => {
        resetFileGcMocks();
    });

    it("uses GC env defaults when variables are absent", () => {
        expect(readFileGcIntervalMs()).toBe(900_000);
        expect(readFileGcRetentionHours()).toBe(168);
        expect(readFileGcQuarantineDays()).toBe(7);
        expect(readFileGcBatchSize()).toBe(200);
    });

    it("quarantines stale detached orphan files instead of deleting them", async () => {
        const file = staleDetachedFile("file-orphan");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);

        const result = await runFileGcBatch(NOW);

        expect(
            mocks.readStaleFileGcCandidatesFromRepository,
        ).toHaveBeenCalledWith({
            detachedBefore: DETACHED_BEFORE,
            quarantinedBefore: QUARANTINED_BEFORE,
            limit: 200,
        });
        expect(mocks.markFilesQuarantined).toHaveBeenCalledWith(
            ["file-orphan"],
            NOW.toISOString(),
        );
        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(console.info).toHaveBeenCalledWith(
            "[file-gc] delete audit",
            expect.objectContaining({
                event: "file_gc_delete",
                fileId: "file-orphan",
                dryRun: false,
                detachedBefore: DETACHED_BEFORE,
                quarantinedBefore: QUARANTINED_BEFORE,
                lifecycle: "detached",
                outcome: "quarantined",
            }),
        );
        expect(result).toMatchObject({
            dryRun: false,
            scanned: 1,
            referenced: 0,
            quarantined: 1,
            wouldQuarantine: 0,
            recovered: 0,
            deleted: 0,
            wouldDelete: 0,
            skippedState: 0,
            skippedReferenced: 0,
            candidateFileIds: ["file-orphan"],
            quarantinedFileIds: ["file-orphan"],
            deletedFileIds: [],
        });
    });

    it("supports dry-run quarantine without metadata mutation", async () => {
        const file = staleDetachedFile("file-dry-run");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);

        const result = await runFileGcBatch(NOW, { dryRun: true });

        expect(mocks.markFilesQuarantined).not.toHaveBeenCalled();
        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(console.info).toHaveBeenCalledWith(
            "[file-gc] delete audit",
            expect.objectContaining({
                fileId: "file-dry-run",
                dryRun: true,
                outcome: "would_quarantine",
            }),
        );
        expect(result.quarantined).toBe(0);
        expect(result.wouldQuarantine).toBe(1);
        expect(result.wouldQuarantineFileIds).toEqual(["file-dry-run"]);
    });

    it("deletes stale quarantined orphan files after the quarantine window", async () => {
        const file = staleQuarantinedFile("file-quarantined");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);

        const result = await runFileGcBatch(NOW);

        expect(mocks.markFilesDeleted).toHaveBeenCalledWith(
            ["file-quarantined"],
            NOW.toISOString(),
        );
        expect(mocks.deleteOrphanFileFromRepository).toHaveBeenCalledWith(
            "file-quarantined",
        );
        expect(result.deleted).toBe(1);
        expect(result.deletedFileIds).toEqual(["file-quarantined"]);
    });

    it("skips quarantined files younger than the quarantine window", async () => {
        const candidate = staleQuarantinedFile("file-fresh-quarantine");
        const current = {
            ...candidate,
            app_quarantined_at: "2026-04-22T00:00:00.000Z",
        };
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            candidate,
        ]);
        mocks.readManagedFilesByIds.mockResolvedValue([current]);

        const result = await runFileGcBatch(NOW);

        expect(mocks.markFilesDeleted).not.toHaveBeenCalled();
        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.deleted).toBe(0);
        expect(result.skippedState).toBe(1);
    });

    it("recovers referenced quarantined candidates to attached", async () => {
        const file = staleQuarantinedFile("file-referenced");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);
        mocks.collectReferencedDirectusFileIds.mockResolvedValue(
            new Set(["file-referenced"]),
        );

        const result = await runFileGcBatch(NOW);

        expect(mocks.markFilesAttached).toHaveBeenCalledWith({
            fileIds: ["file-referenced"],
        });
        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.recovered).toBe(1);
        expect(result.recoveredFileIds).toEqual(["file-referenced"]);
        expect(result.skippedReferenced).toBe(1);
    });

    it("rechecks references before changing each orphan", async () => {
        const file = staleDetachedFile("file-raced");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);
        mocks.collectReferencedDirectusFileIds
            .mockResolvedValueOnce(new Set())
            .mockResolvedValueOnce(new Set(["file-raced"]));

        const result = await runFileGcBatch(NOW);

        expect(mocks.collectReferencedDirectusFileIds).toHaveBeenCalledTimes(2);
        expect(mocks.markFilesAttached).toHaveBeenCalledWith({
            fileIds: ["file-raced"],
        });
        expect(mocks.markFilesQuarantined).not.toHaveBeenCalled();
        expect(result.recovered).toBe(1);
        expect(result.skippedReferenced).toBe(1);
    });

    it("skips current lifecycle rows that are not GC eligible", async () => {
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            staleDetachedFile("file-attached"),
            staleDetachedFile("file-protected"),
            {
                id: "file-temporary",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
                app_quarantined_at: null,
                app_deleted_at: null,
            },
            {
                ...staleDetachedFile("file-fresh-detached"),
                app_detached_at: "2026-04-22T00:00:00.000Z",
            },
        ]);
        mocks.readManagedFilesByIds.mockResolvedValue([
            {
                id: "file-attached",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "attached",
                app_detached_at: null,
                app_quarantined_at: null,
                app_deleted_at: null,
            },
            {
                id: "file-protected",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "protected",
                app_detached_at: null,
                app_quarantined_at: null,
                app_deleted_at: null,
            },
            {
                id: "file-temporary",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
                app_quarantined_at: null,
                app_deleted_at: null,
            },
            {
                id: "file-fresh-detached",
                date_created: "2026-04-20T00:00:00.000Z",
                app_lifecycle: "detached",
                app_detached_at: "2026-04-22T00:00:00.000Z",
                app_quarantined_at: null,
                app_deleted_at: null,
            },
        ]);

        const result = await runFileGcBatch(NOW);

        expect(mocks.markFilesQuarantined).not.toHaveBeenCalled();
        expect(mocks.markFilesDeleted).not.toHaveBeenCalled();
        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.skippedState).toBe(4);
        expect(result.skippedReferenced).toBe(0);
    });

    it("marks failed physical deletes as deleted so future batches can retry", async () => {
        const quarantined = staleQuarantinedFile("file-failed");
        const deleted = {
            ...staleQuarantinedFile("file-retry"),
            app_lifecycle: "deleted" as const,
            app_deleted_at: "2026-04-27T00:00:00.000Z",
        };
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            quarantined,
            deleted,
        ]);
        mocks.readManagedFilesByIds
            .mockResolvedValueOnce([quarantined, deleted])
            .mockResolvedValueOnce([quarantined])
            .mockResolvedValueOnce([deleted]);
        mocks.deleteOrphanFileFromRepository
            .mockResolvedValueOnce({
                ok: false,
                fileId: "file-failed",
                reason: "network",
            })
            .mockResolvedValueOnce({
                ok: true,
                fileId: "file-retry",
            });

        const result = await runFileGcBatch(NOW);

        expect(mocks.markFilesDeleted).toHaveBeenCalledTimes(1);
        expect(mocks.markFilesDeleted).toHaveBeenCalledWith(
            ["file-failed"],
            NOW.toISOString(),
        );
        expect(mocks.deleteOrphanFileFromRepository).toHaveBeenCalledWith(
            "file-failed",
        );
        expect(mocks.deleteOrphanFileFromRepository).toHaveBeenCalledWith(
            "file-retry",
        );
        expect(console.error).toHaveBeenCalledWith(
            "[file-gc] delete audit",
            expect.objectContaining({
                fileId: "file-failed",
                outcome: "failed",
                reason: "network",
            }),
        );
        expect(result.failed).toBe(1);
        expect(result.deleted).toBe(1);
        expect(result.deletedFileIds).toEqual(["file-retry"]);
    });

    it("audits not found delete outcomes", async () => {
        const file = staleQuarantinedFile("file-not-found");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);
        mocks.deleteOrphanFileFromRepository.mockResolvedValueOnce({
            ok: false,
            fileId: "file-not-found",
            reason: "not_found",
        });

        const result = await runFileGcBatch(NOW);

        expect(console.warn).toHaveBeenCalledWith(
            "[file-gc] delete audit",
            expect.objectContaining({
                fileId: "file-not-found",
                outcome: "not_found",
                reason: "not_found",
            }),
        );
        expect(result.notFound).toBe(1);
    });
});
