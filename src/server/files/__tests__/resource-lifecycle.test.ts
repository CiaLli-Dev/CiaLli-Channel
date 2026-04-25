import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    assertFilesAttachable: vi.fn(),
    createOne: vi.fn(),
    deleteOne: vi.fn(),
    markFilesAttached: vi.fn(),
    markFilesDetached: vi.fn(),
    readFileReferencesByFileIds: vi.fn(),
    readManagedFilesByIds: vi.fn(),
    readOwnerFileReferences: vi.fn(),
    readOwnerSourceReferencedFileIdsFromRepository: vi.fn(),
    replaceOwnerFieldReferences: vi.fn(),
    updateOne: vi.fn(),
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/directus/client", () => ({
    createOne: mocks.createOne,
    deleteOne: mocks.deleteOne,
    updateOne: mocks.updateOne,
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: mocks.withServiceRepositoryContext,
}));

vi.mock("@/server/repositories/files/file-lifecycle.repository", () => ({
    assertFilesAttachable: mocks.assertFilesAttachable,
    FILE_LIFECYCLE_NOT_ATTACHABLE_CODE: "FILE_LIFECYCLE_NOT_ATTACHABLE",
    markFilesAttached: mocks.markFilesAttached,
    markFilesDetached: mocks.markFilesDetached,
    readManagedFilesByIds: mocks.readManagedFilesByIds,
}));

vi.mock("@/server/repositories/files/file-reference.repository", () => ({
    readFileReferencesByFileIds: mocks.readFileReferencesByFileIds,
    readOwnerFileReferences: mocks.readOwnerFileReferences,
    replaceOwnerFieldReferences: mocks.replaceOwnerFieldReferences,
}));

vi.mock("@/server/repositories/files/file-cleanup.repository", () => ({
    readOwnerSourceReferencedFileIdsFromRepository:
        mocks.readOwnerSourceReferencedFileIdsFromRepository,
}));

import {
    markResourceReferenceSyncJobSucceeded,
    parseResourceReferenceSyncJobPayload,
    replayResourceReferenceSyncJob,
    resourceLifecycle,
} from "@/server/files/resource-lifecycle";
import { AppError } from "@/server/api/errors";

const FILE_KEEP = "11111111-1111-4111-8111-111111111111";
const FILE_NEW = "22222222-2222-4222-8222-222222222222";
const FILE_OLD = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOne.mockResolvedValue({
        id: "job-1",
        status: "pending",
    });
    mocks.deleteOne.mockResolvedValue(undefined);
    mocks.assertFilesAttachable.mockResolvedValue(undefined);
    mocks.markFilesAttached.mockResolvedValue(undefined);
    mocks.markFilesDetached.mockResolvedValue(undefined);
    mocks.readFileReferencesByFileIds.mockResolvedValue([]);
    mocks.readManagedFilesByIds.mockResolvedValue([]);
    mocks.readOwnerFileReferences.mockResolvedValue([]);
    mocks.readOwnerSourceReferencedFileIdsFromRepository.mockResolvedValue([]);
    mocks.replaceOwnerFieldReferences.mockResolvedValue({
        created: 0,
        updated: 0,
        deleted: 0,
        fileIds: [],
    });
    mocks.updateOne.mockResolvedValue({});
});

it("syncs owner references and detaches files removed from the owner", async () => {
    mocks.readOwnerFileReferences.mockResolvedValue([
        {
            id: "ref-keep",
            file_id: FILE_KEEP,
            owner_field: "body",
            reference_kind: "markdown_asset",
        },
        {
            id: "ref-old",
            file_id: FILE_OLD,
            owner_field: "body",
            reference_kind: "markdown_asset",
        },
    ]);

    const result = await resourceLifecycle.syncOwnerReferences({
        ownerCollection: "app_article_comments",
        ownerId: "comment-1",
        ownerUserId: "user-1",
        visibility: "public",
        references: [
            {
                ownerField: "body",
                referenceKind: "markdown_asset",
                fileIds: [FILE_KEEP, FILE_NEW, FILE_NEW],
            },
        ],
    });

    expect(mocks.replaceOwnerFieldReferences).toHaveBeenCalledWith(
        expect.objectContaining({
            ownerCollection: "app_article_comments",
            ownerId: "comment-1",
            ownerField: "body",
            referenceKind: "markdown_asset",
            fileIds: [FILE_KEEP, FILE_NEW],
            ownerUserId: "user-1",
            visibility: "public",
        }),
    );
    expect(mocks.markFilesAttached).toHaveBeenCalledWith({
        fileIds: [FILE_KEEP, FILE_NEW],
        ownerUserId: "user-1",
        visibility: "public",
    });
    expect(mocks.markFilesDetached).toHaveBeenCalledWith(
        [FILE_OLD],
        expect.any(String),
    );
    expect(result).toMatchObject({
        attachedFileIds: [FILE_KEEP, FILE_NEW],
        detachedFileIds: [FILE_OLD],
    });
});

it("keeps untouched owner fields alive during partial sync", async () => {
    mocks.readOwnerFileReferences.mockResolvedValue([
        {
            id: "ref-cover",
            file_id: FILE_OLD,
            owner_field: "cover_file",
            reference_kind: "structured_field",
        },
    ]);

    await resourceLifecycle.syncOwnerReferences({
        ownerCollection: "app_articles",
        ownerId: "article-1",
        ownerUserId: "user-1",
        visibility: "private",
        references: [
            {
                ownerField: "body_markdown",
                referenceKind: "markdown_asset",
                fileIds: [FILE_NEW],
            },
        ],
    });

    expect(mocks.markFilesDetached).toHaveBeenCalledWith(
        [],
        expect.any(String),
    );
});

it("does not detach files still referenced by another owner", async () => {
    mocks.readOwnerFileReferences.mockResolvedValue([
        {
            id: "ref-old",
            file_id: FILE_OLD,
            owner_field: "body",
            reference_kind: "markdown_asset",
        },
    ]);
    mocks.readFileReferencesByFileIds.mockResolvedValue([
        {
            id: "ref-other",
            file_id: FILE_OLD,
            owner_collection: "app_articles",
            owner_id: "article-2",
            owner_field: "body_markdown",
            reference_kind: "markdown_asset",
            owner_user_id: "user-2",
            visibility: "public",
        },
    ]);

    const result = await resourceLifecycle.syncOwnerReferences({
        ownerCollection: "app_articles",
        ownerId: "article-1",
        ownerUserId: "user-1",
        visibility: "private",
        references: [
            {
                ownerField: "body",
                referenceKind: "markdown_asset",
                fileIds: [],
            },
        ],
    });

    expect(mocks.readFileReferencesByFileIds).toHaveBeenCalledWith([FILE_OLD]);
    expect(mocks.markFilesDetached).toHaveBeenCalledWith(
        [],
        expect.any(String),
    );
    expect(mocks.markFilesAttached).toHaveBeenCalledWith({
        fileIds: [FILE_OLD],
        ownerUserId: "user-2",
        visibility: "public",
        allowLifecycleOverride: true,
    });
    expect(result.detachedFileIds).toEqual([]);
});

it("enqueues a replayable sync job when the write barrier fails", async () => {
    mocks.replaceOwnerFieldReferences.mockRejectedValueOnce(
        new Error("network timeout"),
    );

    await expect(
        resourceLifecycle.syncOwnerReferences({
            ownerCollection: "app_articles",
            ownerId: "article-1",
            ownerUserId: "user-1",
            visibility: "public",
            references: [
                {
                    ownerField: "body_markdown",
                    referenceKind: "markdown_asset",
                    fileIds: [FILE_NEW],
                },
            ],
        }),
    ).resolves.toMatchObject({
        attachedFileIds: [FILE_NEW],
        detachedFileIds: [],
    });

    expect(mocks.createOne).toHaveBeenCalledWith(
        "app_file_detach_jobs",
        expect.objectContaining({
            status: "pending",
            source_type: "resource.references.sync",
            source_id: "article-1",
            candidate_file_ids: expect.objectContaining({
                ownerCollection: "app_articles",
                ownerId: "article-1",
                ownerUserId: "user-1",
                visibility: "public",
            }),
        }),
        { fields: ["id"] },
    );
});

it("rejects non-attachable files before writing references", async () => {
    mocks.assertFilesAttachable.mockRejectedValueOnce(
        new AppError(
            "FILE_LIFECYCLE_NOT_ATTACHABLE",
            "文件处于待删除或隔离状态，不能直接绑定",
            409,
            { fileIds: [FILE_NEW] },
        ),
    );

    await expect(
        resourceLifecycle.syncOwnerReferences({
            ownerCollection: "app_articles",
            ownerId: "article-1",
            ownerUserId: "user-1",
            visibility: "public",
            references: [
                {
                    ownerField: "body_markdown",
                    referenceKind: "markdown_asset",
                    fileIds: [FILE_NEW],
                },
            ],
        }),
    ).rejects.toMatchObject({
        code: "FILE_LIFECYCLE_NOT_ATTACHABLE",
        status: 409,
    });

    expect(mocks.replaceOwnerFieldReferences).not.toHaveBeenCalled();
    expect(mocks.createOne).not.toHaveBeenCalled();
});

it("releases owner resources by writing a release job without deleting live references", async () => {
    mocks.readOwnerFileReferences.mockResolvedValue([
        { id: "ref-1", file_id: FILE_KEEP },
        { id: "ref-2", file_id: FILE_NEW },
    ]);

    const result = await resourceLifecycle.releaseOwnerResources({
        ownerCollection: "app_articles",
        ownerId: "article-1",
    });

    expect(mocks.createOne).toHaveBeenCalledWith(
        "app_file_detach_jobs",
        expect.objectContaining({
            status: "pending",
            source_type: "resource.owner.release:app_articles",
            source_id: "article-1",
            candidate_file_ids: [FILE_KEEP, FILE_NEW],
        }),
        { fields: ["id", "status"] },
    );
    expect(mocks.deleteOne).not.toHaveBeenCalled();
    expect(result).toEqual({
        jobId: "job-1",
        status: "pending",
        candidateFileIds: [FILE_KEEP, FILE_NEW],
        deletedReferences: 0,
    });
});

it("includes source-scanned file ids when the owner reference table is incomplete", async () => {
    mocks.readOwnerFileReferences.mockResolvedValue([
        { id: "ref-1", file_id: FILE_KEEP },
    ]);
    mocks.readOwnerSourceReferencedFileIdsFromRepository.mockResolvedValue([
        FILE_NEW,
        FILE_KEEP,
    ]);

    const result = await resourceLifecycle.releaseOwnerResources({
        ownerCollection: "app_articles",
        ownerId: "article-1",
    });

    expect(
        mocks.readOwnerSourceReferencedFileIdsFromRepository,
    ).toHaveBeenCalledWith({
        ownerCollection: "app_articles",
        ownerId: "article-1",
    });
    expect(mocks.createOne).toHaveBeenCalledWith(
        "app_file_detach_jobs",
        expect.objectContaining({
            status: "pending",
            source_type: "resource.owner.release:app_articles",
            source_id: "article-1",
            candidate_file_ids: [FILE_KEEP, FILE_NEW],
        }),
        { fields: ["id", "status"] },
    );
    expect(result.candidateFileIds).toEqual([FILE_KEEP, FILE_NEW]);
});

it("marks empty owner release as skipped", async () => {
    mocks.createOne.mockResolvedValue({
        id: "job-empty",
        status: "skipped",
    });

    await expect(
        resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_articles",
            ownerId: "article-empty",
        }),
    ).resolves.toEqual({
        jobId: "job-empty",
        status: "skipped",
        candidateFileIds: [],
        deletedReferences: 0,
    });
});

it("restores only quarantined files with live references and fixes owner metadata", async () => {
    mocks.readManagedFilesByIds.mockResolvedValue([
        {
            id: FILE_KEEP,
            app_lifecycle: "quarantined",
        },
        {
            id: FILE_OLD,
            app_lifecycle: "detached",
        },
    ]);
    mocks.readFileReferencesByFileIds.mockResolvedValue([
        {
            id: "ref-1",
            file_id: FILE_KEEP,
            owner_collection: "app_articles",
            owner_id: "article-1",
            owner_field: "body_markdown",
            reference_kind: "markdown_asset",
            owner_user_id: "user-1",
            visibility: "public",
        },
    ]);

    const result = await resourceLifecycle.restoreQuarantinedFiles({
        fileIds: [FILE_KEEP, FILE_OLD, FILE_NEW],
        requireReference: true,
    });

    expect(mocks.readManagedFilesByIds).toHaveBeenCalledWith([
        FILE_KEEP,
        FILE_NEW,
        FILE_OLD,
    ]);
    expect(mocks.readFileReferencesByFileIds).toHaveBeenCalledWith([
        FILE_KEEP,
        FILE_NEW,
        FILE_OLD,
    ]);
    expect(mocks.markFilesAttached).toHaveBeenCalledWith({
        fileIds: [FILE_KEEP],
        ownerUserId: "user-1",
        visibility: "public",
        allowLifecycleOverride: true,
    });
    expect(result).toEqual({
        requestedFileIds: [FILE_KEEP, FILE_NEW, FILE_OLD],
        restoredFileIds: [FILE_KEEP],
        skippedMissingFileIds: [FILE_NEW],
        skippedNotQuarantinedFileIds: [FILE_OLD],
        skippedUnreferencedFileIds: [],
    });
});

it("blocks quarantined restore without a reference by default", async () => {
    mocks.readManagedFilesByIds.mockResolvedValue([
        {
            id: FILE_KEEP,
            app_lifecycle: "quarantined",
        },
    ]);

    const result = await resourceLifecycle.restoreQuarantinedFiles({
        fileIds: [FILE_KEEP],
    });

    expect(mocks.markFilesAttached).not.toHaveBeenCalled();
    expect(result.skippedUnreferencedFileIds).toEqual([FILE_KEEP]);
});

it("parses and replays resource sync job payloads", async () => {
    const payload = parseResourceReferenceSyncJobPayload({
        ownerCollection: "app_articles",
        ownerId: "article-1",
        ownerUserId: "user-1",
        visibility: "public",
        references: [
            {
                ownerField: "body_markdown",
                referenceKind: "markdown_asset",
                fileIds: [FILE_NEW],
            },
        ],
    });

    expect(payload).not.toBeNull();
    if (!payload) {
        return;
    }
    await replayResourceReferenceSyncJob(payload);
    await markResourceReferenceSyncJobSucceeded({
        jobId: "job-1",
        nowIso: "2026-04-25T00:00:00.000Z",
    });

    expect(mocks.replaceOwnerFieldReferences).toHaveBeenCalled();
    expect(mocks.updateOne).toHaveBeenCalledWith(
        "app_file_detach_jobs",
        "job-1",
        expect.objectContaining({
            status: "succeeded",
            finished_at: "2026-04-25T00:00:00.000Z",
        }),
    );
});
