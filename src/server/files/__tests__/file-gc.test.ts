import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    collectReferencedDirectusFileIds: vi.fn(),
    readStaleFileGcCandidatesFromRepository: vi.fn(),
    deleteOrphanFileFromRepository: vi.fn(),
    claimFileForDelete: vi.fn(),
    claimFileForQuarantine: vi.fn(),
    markFileDeleteDeadLetter: vi.fn(),
    markFileDeleteRetry: vi.fn(),
    markFilesAttached: vi.fn(),
    readManagedFilesByIds: vi.fn(),
    restoreQuarantinedFiles: vi.fn(),
    seedFileReferencesWhenEmpty: vi.fn(),
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
    claimFileForDelete: mocks.claimFileForDelete,
    claimFileForQuarantine: mocks.claimFileForQuarantine,
    markFileDeleteDeadLetter: mocks.markFileDeleteDeadLetter,
    markFileDeleteRetry: mocks.markFileDeleteRetry,
    markFilesAttached: mocks.markFilesAttached,
    readManagedFilesByIds: mocks.readManagedFilesByIds,
}));

vi.mock("@/server/files/file-reference-shadow", () => ({
    seedFileReferencesWhenEmpty: mocks.seedFileReferencesWhenEmpty,
}));

vi.mock("@/server/files/resource-lifecycle", () => ({
    resourceLifecycle: {
        restoreQuarantinedFiles: mocks.restoreQuarantinedFiles,
    },
}));

import {
    readFileGcBatchSize,
    readFileGcDeleteMaxAttempts,
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
    delete process.env.FILE_GC_DELETE_MAX_ATTEMPTS;
    mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([]);
    mocks.collectReferencedDirectusFileIds.mockResolvedValue(new Set());
    mocks.deleteOrphanFileFromRepository.mockResolvedValue({
        ok: true,
        fileId: "file-1",
    });
    mocks.claimFileForDelete.mockResolvedValue(true);
    mocks.claimFileForQuarantine.mockResolvedValue(true);
    mocks.markFileDeleteDeadLetter.mockResolvedValue(undefined);
    mocks.markFileDeleteRetry.mockResolvedValue(undefined);
    mocks.markFilesAttached.mockResolvedValue(undefined);
    mocks.readManagedFilesByIds.mockResolvedValue([]);
    mocks.seedFileReferencesWhenEmpty.mockResolvedValue(0);
    mocks.restoreQuarantinedFiles.mockResolvedValue({
        requestedFileIds: [],
        restoredFileIds: [],
        skippedMissingFileIds: [],
        skippedNotQuarantinedFileIds: [],
        skippedUnreferencedFileIds: [],
    });
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

describe("file-gc config", () => {
    beforeEach(() => {
        resetFileGcMocks();
    });

    it("uses GC env defaults when variables are absent", () => {
        expect(readFileGcIntervalMs()).toBe(900_000);
        expect(readFileGcRetentionHours()).toBe(168);
        expect(readFileGcQuarantineDays()).toBe(7);
        expect(readFileGcBatchSize()).toBe(200);
        expect(readFileGcDeleteMaxAttempts()).toBe(6);
    });
});

describe("file-gc lifecycle phases", () => {
    beforeEach(() => {
        resetFileGcMocks();
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
            deleteRetryBefore: NOW.toISOString(),
            limit: 200,
        });
        expect(mocks.seedFileReferencesWhenEmpty).toHaveBeenCalledTimes(1);
        expect(mocks.claimFileForQuarantine).toHaveBeenCalledWith({
            fileId: "file-orphan",
            detachedBefore: DETACHED_BEFORE,
            quarantinedAt: NOW.toISOString(),
        });
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

        expect(mocks.claimFileForQuarantine).not.toHaveBeenCalled();
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

        expect(mocks.claimFileForDelete).toHaveBeenCalledWith({
            fileId: "file-quarantined",
            deletedAt: NOW.toISOString(),
            retryAfter: "2026-04-28T00:15:00.000Z",
            quarantinedBefore: QUARANTINED_BEFORE,
            deleteRetryBefore: NOW.toISOString(),
        });
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

        expect(mocks.claimFileForDelete).not.toHaveBeenCalled();
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
        mocks.restoreQuarantinedFiles.mockResolvedValueOnce({
            requestedFileIds: ["file-referenced"],
            restoredFileIds: ["file-referenced"],
            skippedMissingFileIds: [],
            skippedNotQuarantinedFileIds: [],
            skippedUnreferencedFileIds: [],
        });

        const result = await runFileGcBatch(NOW);

        expect(mocks.restoreQuarantinedFiles).toHaveBeenCalledWith({
            fileIds: ["file-referenced"],
            requireReference: true,
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
            allowLifecycleOverride: true,
        });
        expect(mocks.claimFileForQuarantine).not.toHaveBeenCalled();
        expect(result.recovered).toBe(1);
        expect(result.skippedReferenced).toBe(1);
    });

    it("skips a file when the quarantine claim loses the race", async () => {
        const file = staleDetachedFile("file-claimed-elsewhere");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);
        mocks.claimFileForQuarantine.mockResolvedValueOnce(false);

        const result = await runFileGcBatch(NOW);

        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.quarantined).toBe(0);
        expect(result.skippedState).toBe(1);
    });

    it("isolates per-file claim failures and keeps processing later candidates", async () => {
        const failed = staleDetachedFile("file-claim-error");
        const processed = staleDetachedFile("file-next");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([
            failed,
            processed,
        ]);
        mocks.readManagedFilesByIds.mockResolvedValue([failed, processed]);
        mocks.claimFileForQuarantine
            .mockRejectedValueOnce(new Error("directus timeout"))
            .mockResolvedValueOnce(true);

        const result = await runFileGcBatch(NOW);

        expect(mocks.claimFileForQuarantine).toHaveBeenCalledTimes(2);
        expect(console.error).toHaveBeenCalledWith(
            "[file-gc] delete audit",
            expect.objectContaining({
                fileId: "file-claim-error",
                outcome: "failed",
                reason: "candidate_processing_failed",
                message: "directus timeout",
            }),
        );
        expect(result.failed).toBe(1);
        expect(result.quarantined).toBe(1);
        expect(result.quarantinedFileIds).toEqual(["file-next"]);
    });
});

describe("file-gc state filtering and delete retries", () => {
    beforeEach(() => {
        resetFileGcMocks();
    });

    it("uses the reference table result after migration backfill", async () => {
        const file = staleDetachedFile("file-table-orphan");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);
        mocks.seedFileReferencesWhenEmpty.mockResolvedValue(5);
        mocks.collectReferencedDirectusFileIds.mockResolvedValue(new Set());

        const result = await runFileGcBatch(NOW);

        expect(mocks.seedFileReferencesWhenEmpty).toHaveBeenCalledTimes(1);
        expect(mocks.collectReferencedDirectusFileIds).toHaveBeenCalledWith([
            "file-table-orphan",
        ]);
        expect(mocks.claimFileForQuarantine).toHaveBeenCalledWith({
            fileId: "file-table-orphan",
            detachedBefore: DETACHED_BEFORE,
            quarantinedAt: NOW.toISOString(),
        });
        expect(result.quarantined).toBe(1);
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

        expect(mocks.claimFileForQuarantine).not.toHaveBeenCalled();
        expect(mocks.claimFileForDelete).not.toHaveBeenCalled();
        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(result.skippedState).toBe(4);
        expect(result.skippedReferenced).toBe(0);
    });

    it("backs off failed physical deletes without blocking later candidates", async () => {
        const quarantined = staleQuarantinedFile("file-failed");
        const deleted = {
            ...staleQuarantinedFile("file-retry"),
            app_lifecycle: "deleted" as const,
            app_deleted_at: "2026-04-27T00:00:00.000Z",
            app_delete_attempts: 1,
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

        expect(mocks.claimFileForDelete).toHaveBeenCalledWith({
            fileId: "file-failed",
            deletedAt: NOW.toISOString(),
            retryAfter: "2026-04-28T00:15:00.000Z",
            quarantinedBefore: QUARANTINED_BEFORE,
            deleteRetryBefore: NOW.toISOString(),
        });
        expect(mocks.markFileDeleteRetry).toHaveBeenCalledWith({
            fileId: "file-failed",
            attempts: 1,
            nextRetryAt: "2026-04-28T00:15:00.000Z",
            lastError: "network",
        });
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

    it("skips physical delete when another worker already holds the lease", async () => {
        const file = staleQuarantinedFile("file-delete-raced");
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);
        mocks.claimFileForDelete.mockResolvedValueOnce(false);

        const result = await runFileGcBatch(NOW);

        expect(mocks.deleteOrphanFileFromRepository).not.toHaveBeenCalled();
        expect(mocks.markFileDeleteRetry).not.toHaveBeenCalled();
        expect(result.deleted).toBe(0);
        expect(result.skippedState).toBe(1);
    });

    it("dead-letters physical deletes after the configured max attempts", async () => {
        process.env.FILE_GC_DELETE_MAX_ATTEMPTS = "2";
        const file = {
            ...staleQuarantinedFile("file-dead-letter"),
            app_lifecycle: "deleted" as const,
            app_deleted_at: "2026-04-27T00:00:00.000Z",
            app_delete_attempts: 1,
        };
        mocks.readStaleFileGcCandidatesFromRepository.mockResolvedValue([file]);
        mocks.readManagedFilesByIds.mockResolvedValue([file]);
        mocks.deleteOrphanFileFromRepository.mockResolvedValueOnce({
            ok: false,
            fileId: "file-dead-letter",
            reason: "permission",
        });

        const result = await runFileGcBatch(NOW);

        expect(mocks.markFileDeleteRetry).not.toHaveBeenCalled();
        expect(mocks.markFileDeleteDeadLetter).toHaveBeenCalledWith({
            fileId: "file-dead-letter",
            attempts: 2,
            deadLetteredAt: NOW.toISOString(),
            lastError: "permission",
        });
        expect(console.info).toHaveBeenCalledWith(
            "[file-gc] delete audit",
            expect.objectContaining({
                fileId: "file-dead-letter",
                outcome: "dead_lettered",
                reason: "permission",
            }),
        );
        expect(result.failed).toBe(0);
        expect(result.deadLettered).toBe(1);
        expect(result.deadLetteredFileIds).toEqual(["file-dead-letter"]);
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
