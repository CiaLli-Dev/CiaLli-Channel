import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    collectAllReferencedDirectusFileIds: vi.fn(),
    markFilesAttached: vi.fn(),
    markFilesDetached: vi.fn(),
    markFilesTemporary: vi.fn(),
    readAllManagedFiles: vi.fn(),
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
    });

    it("classifies referenced and unreferenced files into attached/detached/temporary/protected", async () => {
        mocks.collectAllReferencedDirectusFileIds.mockResolvedValue(
            new Set(["file-attached"]),
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
        ]);

        const result = await reconcileManagedFileLifecycle(
            "2026-04-23T00:00:00.000Z",
        );

        expect(mocks.markFilesAttached).toHaveBeenCalledWith({
            fileIds: ["file-attached"],
        });
        expect(mocks.markFilesTemporary).toHaveBeenCalledWith([
            "file-temporary",
        ]);
        expect(mocks.markFilesDetached).toHaveBeenCalledWith(
            ["file-detached"],
            "2026-04-22T00:00:00.000Z",
        );
        expect(result).toEqual({
            attached: 1,
            detached: 1,
            temporary: 1,
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
        });
        expect(mocks.markFilesTemporary).toHaveBeenCalledWith([]);
    });
});
