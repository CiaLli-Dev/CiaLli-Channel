import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    collectAllReferencedDirectusFileIds: vi.fn(),
    markFilesAttached: vi.fn(),
    markFilesDetached: vi.fn(),
    markFilesTemporary: vi.fn(),
    readAllManagedFiles: vi.fn(),
    restoreQuarantinedFiles: vi.fn(),
    seedFileReferencesWhenEmpty: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    collectAllReferencedDirectusFileIds:
        mocks.collectAllReferencedDirectusFileIds,
}));

vi.mock("@/server/repositories/files/file-lifecycle.repository", () => ({
    markFilesAttached: mocks.markFilesAttached,
    markFilesDetached: mocks.markFilesDetached,
    markFilesTemporary: mocks.markFilesTemporary,
    readAllManagedFiles: mocks.readAllManagedFiles,
}));

vi.mock("@/server/files/file-gc", () => ({
    readFileGcRetentionHours: vi.fn(() => 24),
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
    reconcileManagedFileLifecycle,
    readFileLifecycleReconcileIntervalMs,
    runManagedFileLifecycleReconciliation,
} from "@/server/files/file-lifecycle-reconciliation";

describe("file-lifecycle-reconciliation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.FILE_LIFECYCLE_RECONCILE_INTERVAL_MS;
        mocks.collectAllReferencedDirectusFileIds.mockResolvedValue(new Set());
        mocks.markFilesAttached.mockResolvedValue(undefined);
        mocks.markFilesDetached.mockResolvedValue(undefined);
        mocks.markFilesTemporary.mockResolvedValue(undefined);
        mocks.readAllManagedFiles.mockResolvedValue([]);
        mocks.seedFileReferencesWhenEmpty.mockResolvedValue(0);
        mocks.restoreQuarantinedFiles.mockResolvedValue({
            requestedFileIds: [],
            restoredFileIds: [],
            skippedMissingFileIds: [],
            skippedNotQuarantinedFileIds: [],
            skippedUnreferencedFileIds: [],
        });
    });

    it("classifies referenced and unreferenced files into managed lifecycle states", async () => {
        mocks.collectAllReferencedDirectusFileIds.mockResolvedValue(
            new Set([
                "file-attached",
                "file-quarantined-referenced",
                "file-deleted",
            ]),
        );
        mocks.readAllManagedFiles.mockResolvedValue([
            {
                id: "file-attached",
                date_created: "2026-04-20T00:00:00.000Z",
                date_updated: "2026-04-21T00:00:00.000Z",
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
            {
                id: "file-detached",
                date_created: "2026-04-20T00:00:00.000Z",
                date_updated: "2026-04-22T00:00:00.000Z",
                app_lifecycle: "attached",
                app_detached_at: null,
            },
            {
                id: "file-temporary",
                date_created: "2026-04-23T12:00:00.000Z",
                date_updated: null,
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
            {
                id: "file-protected",
                date_created: "2026-04-01T00:00:00.000Z",
                date_updated: "2026-04-02T00:00:00.000Z",
                app_lifecycle: "protected",
                app_detached_at: null,
            },
            {
                id: "file-quarantined",
                date_created: "2026-04-01T00:00:00.000Z",
                date_updated: "2026-04-02T00:00:00.000Z",
                app_lifecycle: "quarantined",
                app_detached_at: "2026-04-03T00:00:00.000Z",
                app_quarantined_at: "2026-04-10T00:00:00.000Z",
                app_deleted_at: null,
            },
            {
                id: "file-quarantined-referenced",
                date_created: "2026-04-01T00:00:00.000Z",
                date_updated: "2026-04-02T00:00:00.000Z",
                app_lifecycle: "quarantined",
                app_detached_at: "2026-04-03T00:00:00.000Z",
                app_quarantined_at: "2026-04-10T00:00:00.000Z",
                app_deleted_at: null,
            },
            {
                id: "file-deleted",
                date_created: "2026-04-01T00:00:00.000Z",
                date_updated: "2026-04-02T00:00:00.000Z",
                app_lifecycle: "deleted",
                app_detached_at: "2026-04-03T00:00:00.000Z",
                app_quarantined_at: "2026-04-10T00:00:00.000Z",
                app_deleted_at: "2026-04-20T00:00:00.000Z",
            },
        ]);
        mocks.restoreQuarantinedFiles.mockResolvedValueOnce({
            requestedFileIds: ["file-quarantined-referenced"],
            restoredFileIds: ["file-quarantined-referenced"],
            skippedMissingFileIds: [],
            skippedNotQuarantinedFileIds: [],
            skippedUnreferencedFileIds: [],
        });

        const result = await reconcileManagedFileLifecycle(
            "2026-04-23T00:00:00.000Z",
        );

        expect(mocks.seedFileReferencesWhenEmpty).toHaveBeenCalledTimes(1);
        expect(mocks.markFilesAttached).toHaveBeenCalledWith({
            fileIds: ["file-attached"],
            allowLifecycleOverride: true,
        });
        expect(mocks.restoreQuarantinedFiles).toHaveBeenCalledWith({
            fileIds: ["file-quarantined-referenced"],
            requireReference: true,
        });
        expect(mocks.markFilesTemporary).toHaveBeenCalledWith([
            "file-temporary",
        ]);
        expect(mocks.markFilesDetached).toHaveBeenCalledWith(
            ["file-detached"],
            "2026-04-22T00:00:00.000Z",
        );
        expect(result).toEqual({
            attached: 2,
            detached: 1,
            temporary: 1,
            quarantined: 1,
            deleted: 1,
            protected: 1,
        });
    });

    it("uses lifecycle reconciliation interval default and GC retention cutoff", async () => {
        expect(readFileLifecycleReconcileIntervalMs()).toBe(86_400_000);

        await runManagedFileLifecycleReconciliation(
            new Date("2026-04-24T00:00:00.000Z"),
        );

        expect(mocks.markFilesAttached).toHaveBeenCalledWith({
            fileIds: [],
            allowLifecycleOverride: true,
        });
        expect(mocks.markFilesTemporary).toHaveBeenCalledWith([]);
    });

    it("runs migration backfill before reading the runtime reference truth", async () => {
        mocks.seedFileReferencesWhenEmpty.mockResolvedValue(2);
        mocks.collectAllReferencedDirectusFileIds.mockResolvedValue(
            new Set(["file-attached"]),
        );
        mocks.readAllManagedFiles.mockResolvedValue([
            {
                id: "file-attached",
                date_created: "2026-04-20T00:00:00.000Z",
                date_updated: null,
                app_lifecycle: "temporary",
                app_detached_at: null,
            },
        ]);

        await reconcileManagedFileLifecycle("2026-04-23T00:00:00.000Z");

        expect(mocks.seedFileReferencesWhenEmpty).toHaveBeenCalledTimes(1);
        expect(mocks.collectAllReferencedDirectusFileIds).toHaveBeenCalledTimes(
            1,
        );
        expect(mocks.markFilesAttached).toHaveBeenCalledWith({
            fileIds: ["file-attached"],
            allowLifecycleOverride: true,
        });
    });
});
