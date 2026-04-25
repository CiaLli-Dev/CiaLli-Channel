import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    readMany: vi.fn(),
    updateDirectusFileMetadata: vi.fn(),
    updateDirectusFilesByFilter: vi.fn(),
    updateManyItemsByFilter: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    readMany: mocks.readMany,
    updateDirectusFileMetadata: mocks.updateDirectusFileMetadata,
    updateDirectusFilesByFilter: mocks.updateDirectusFilesByFilter,
    updateManyItemsByFilter: mocks.updateManyItemsByFilter,
}));

import {
    claimFileForDelete,
    claimFileForQuarantine,
    markFilesAttached,
} from "@/server/repositories/files/file-lifecycle.repository";

const FILE_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.readMany.mockResolvedValue([
        {
            id: FILE_ID,
            app_lifecycle: "temporary",
        },
    ]);
    mocks.updateDirectusFileMetadata.mockResolvedValue(undefined);
    mocks.updateDirectusFilesByFilter.mockResolvedValue([{ id: FILE_ID }]);
    mocks.updateManyItemsByFilter.mockResolvedValue(undefined);
});

it("attaches temporary files through the normal binding path", async () => {
    await markFilesAttached({
        fileIds: [FILE_ID],
        ownerUserId: "user-1",
        visibility: "public",
    });

    expect(mocks.readMany).toHaveBeenCalledWith("directus_files", {
        filter: { id: { _in: [FILE_ID] } },
        fields: [
            "id",
            "date_created",
            "date_updated",
            "app_lifecycle",
            "app_detached_at",
            "app_quarantined_at",
            "app_deleted_at",
            "app_delete_attempts",
            "app_delete_next_retry_at",
            "app_delete_last_error",
            "app_delete_dead_lettered_at",
        ],
        limit: 1,
    });
    expect(mocks.updateDirectusFileMetadata).toHaveBeenCalledWith(
        FILE_ID,
        expect.objectContaining({
            app_lifecycle: "attached",
            app_visibility: "public",
            app_owner_user_id: "user-1",
        }),
    );
});

it("rejects files that are already in the delete pipeline", async () => {
    for (const lifecycle of [
        "detached",
        "quarantined",
        "deleting",
        "deleted",
        "delete_failed",
    ] as const) {
        mocks.readMany.mockResolvedValueOnce([
            {
                id: FILE_ID,
                app_lifecycle: lifecycle,
            },
        ]);

        await expect(
            markFilesAttached({
                fileIds: [FILE_ID],
                ownerUserId: "user-1",
                visibility: "public",
            }),
        ).rejects.toMatchObject({
            code: "FILE_LIFECYCLE_NOT_ATTACHABLE",
            status: 409,
        });
    }

    expect(mocks.updateDirectusFileMetadata).not.toHaveBeenCalled();
});

it("allows internal lifecycle repair to reattach managed files", async () => {
    mocks.readMany.mockResolvedValue([
        {
            id: FILE_ID,
            app_lifecycle: "quarantined",
        },
    ]);

    await markFilesAttached({
        fileIds: [FILE_ID],
        visibility: "private",
        allowLifecycleOverride: true,
    });

    expect(mocks.readMany).not.toHaveBeenCalled();
    expect(mocks.updateDirectusFileMetadata).toHaveBeenCalledWith(
        FILE_ID,
        expect.objectContaining({
            app_lifecycle: "attached",
            app_visibility: "private",
        }),
    );
});

it("claims detached files for quarantine with a state predicate", async () => {
    const claimed = await claimFileForQuarantine({
        fileId: FILE_ID,
        detachedBefore: "2026-04-21T00:00:00.000Z",
        quarantinedAt: "2026-04-28T00:00:00.000Z",
    });

    expect(claimed).toBe(true);
    expect(mocks.updateDirectusFilesByFilter).toHaveBeenCalledWith({
        filter: {
            _and: [
                { id: { _eq: FILE_ID } },
                { app_lifecycle: { _eq: "detached" } },
                { app_detached_at: { _nnull: true } },
                { app_detached_at: { _lte: "2026-04-21T00:00:00.000Z" } },
            ],
        },
        data: expect.objectContaining({
            app_lifecycle: "quarantined",
            app_quarantined_at: "2026-04-28T00:00:00.000Z",
        }),
        limit: 1,
        fields: ["id"],
    });
});

it("claims delete work only for due quarantined or retryable rows", async () => {
    const claimed = await claimFileForDelete({
        fileId: FILE_ID,
        deletedAt: "2026-04-28T00:00:00.000Z",
        retryAfter: "2026-04-28T00:15:00.000Z",
        quarantinedBefore: "2026-04-21T00:00:00.000Z",
        deleteRetryBefore: "2026-04-28T00:00:00.000Z",
    });

    expect(claimed).toBe(true);
    expect(mocks.updateDirectusFilesByFilter).toHaveBeenCalledWith({
        filter: {
            _and: [
                { id: { _eq: FILE_ID } },
                {
                    _or: [
                        {
                            _and: [
                                { app_lifecycle: { _eq: "quarantined" } },
                                { app_quarantined_at: { _nnull: true } },
                                {
                                    app_quarantined_at: {
                                        _lte: "2026-04-21T00:00:00.000Z",
                                    },
                                },
                            ],
                        },
                        {
                            _and: [
                                { app_lifecycle: { _eq: "deleted" } },
                                {
                                    _or: [
                                        {
                                            app_delete_next_retry_at: {
                                                _null: true,
                                            },
                                        },
                                        {
                                            app_delete_next_retry_at: {
                                                _lte: "2026-04-28T00:00:00.000Z",
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            _and: [
                                { app_lifecycle: { _eq: "deleting" } },
                                {
                                    _or: [
                                        {
                                            app_delete_next_retry_at: {
                                                _null: true,
                                            },
                                        },
                                        {
                                            app_delete_next_retry_at: {
                                                _lte: "2026-04-28T00:00:00.000Z",
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        data: expect.objectContaining({
            app_lifecycle: "deleting",
            app_deleted_at: "2026-04-28T00:00:00.000Z",
            app_delete_next_retry_at: "2026-04-28T00:15:00.000Z",
        }),
        limit: 1,
        fields: ["id"],
    });
});

it("returns false when a lifecycle claim loses the race", async () => {
    mocks.updateDirectusFilesByFilter.mockResolvedValueOnce([]);

    await expect(
        claimFileForQuarantine({
            fileId: FILE_ID,
            detachedBefore: "2026-04-21T00:00:00.000Z",
            quarantinedAt: "2026-04-28T00:00:00.000Z",
        }),
    ).resolves.toBe(false);
});
