import type { AppFile, AppFileLifecycle } from "@/types/app";
import type { JsonObject } from "@/types/json";

import { AppError } from "@/server/api/errors";
import {
    readMany,
    updateDirectusFileMetadata,
    updateDirectusFilesByFilter,
    updateManyItemsByFilter,
} from "@/server/directus/client";
import {
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup-reference-utils";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";

export type ManagedFileVisibility = "private" | "public";

export const FILE_LIFECYCLE_NOT_ATTACHABLE_CODE =
    "FILE_LIFECYCLE_NOT_ATTACHABLE";

const NON_ATTACHABLE_LIFECYCLES = new Set<AppFileLifecycle>([
    "detached",
    "quarantined",
    "deleting",
    "deleted",
    "delete_failed",
]);

const MANAGED_FILE_FIELDS = [
    "id",
    "created_on",
    "modified_on",
    "app_lifecycle",
    "app_detached_at",
    "app_quarantined_at",
    "app_deleted_at",
    "app_delete_attempts",
    "app_delete_next_retry_at",
    "app_delete_last_error",
    "app_delete_dead_lettered_at",
] as const;

function normalizeFileIds(values: unknown[]): string[] {
    const normalizedIds = new Set<string>();
    for (const value of values) {
        const fileId = normalizeDirectusFileId(value);
        if (fileId) {
            normalizedIds.add(fileId);
        }
    }
    return [...normalizedIds];
}

export function diffFileIds(params: {
    previousFileIds: unknown[];
    nextFileIds: unknown[];
}): {
    attachedFileIds: string[];
    detachedFileIds: string[];
    nextFileIds: string[];
} {
    const previousFileIds = normalizeFileIds(params.previousFileIds);
    const nextFileIds = normalizeFileIds(params.nextFileIds);
    const previousSet = new Set(previousFileIds);
    const nextSet = new Set(nextFileIds);

    return {
        attachedFileIds: nextFileIds.filter(
            (fileId) => !previousSet.has(fileId),
        ),
        detachedFileIds: previousFileIds.filter(
            (fileId) => !nextSet.has(fileId),
        ),
        nextFileIds,
    };
}

export function diffMarkdownFileIds(params: {
    previousMarkdown: string | null | undefined;
    nextMarkdown: string | null | undefined;
}): {
    attachedFileIds: string[];
    detachedFileIds: string[];
    nextFileIds: string[];
} {
    return diffFileIds({
        previousFileIds: extractDirectusAssetIdsFromMarkdown(
            params.previousMarkdown,
        ),
        nextFileIds: extractDirectusAssetIdsFromMarkdown(params.nextMarkdown),
    });
}

async function updateLifecycleForFileIds(params: {
    fileIds: string[];
    data: JsonObject;
}): Promise<void> {
    const fileIds = normalizeFileIds(params.fileIds);
    if (fileIds.length === 0) {
        return;
    }
    await withServiceRepositoryContext(async () => {
        await updateManyItemsByFilter({
            collection: "directus_files",
            filter: { id: { _in: fileIds } } as JsonObject,
            data: params.data,
        });
    });
}

export async function markFilesTemporary(fileIds: string[]): Promise<void> {
    await updateLifecycleForFileIds({
        fileIds,
        data: {
            app_lifecycle: "temporary",
            app_detached_at: null,
            app_quarantined_at: null,
            app_deleted_at: null,
            app_delete_attempts: 0,
            app_delete_next_retry_at: null,
            app_delete_last_error: null,
            app_delete_dead_lettered_at: null,
        },
    });
}

export async function markFilesAttached(params: {
    fileIds: string[];
    ownerUserId?: string | null;
    visibility?: ManagedFileVisibility;
    title?: string;
    allowLifecycleOverride?: boolean;
}): Promise<void> {
    const fileIds = normalizeFileIds(params.fileIds);
    if (fileIds.length === 0) {
        return;
    }
    if (params.allowLifecycleOverride !== true) {
        await assertFilesAttachable(fileIds);
    }
    const lifecyclePayload: JsonObject = {
        app_lifecycle: "attached" satisfies AppFileLifecycle,
        app_detached_at: null,
        app_quarantined_at: null,
        app_deleted_at: null,
        app_delete_attempts: 0,
        app_delete_next_retry_at: null,
        app_delete_last_error: null,
        app_delete_dead_lettered_at: null,
    };
    if (params.ownerUserId !== undefined) {
        lifecyclePayload.uploaded_by = params.ownerUserId;
        lifecyclePayload.app_owner_user_id = params.ownerUserId;
    }
    if (params.visibility !== undefined) {
        lifecyclePayload.app_visibility = params.visibility;
    }

    if (fileIds.length === 1) {
        await withServiceRepositoryContext(async () => {
            await updateDirectusFileMetadata(fileIds[0], {
                ...(lifecyclePayload as {
                    uploaded_by?: string | null;
                    app_owner_user_id?: string | null;
                    app_visibility?: ManagedFileVisibility;
                    app_lifecycle?: AppFileLifecycle;
                    app_detached_at?: string | null;
                    app_quarantined_at?: string | null;
                    app_deleted_at?: string | null;
                    app_delete_attempts?: number | null;
                    app_delete_next_retry_at?: string | null;
                    app_delete_last_error?: string | null;
                    app_delete_dead_lettered_at?: string | null;
                }),
                title: params.title?.trim() || undefined,
            });
        });
        return;
    }

    await updateLifecycleForFileIds({
        fileIds,
        data: lifecyclePayload,
    });
}

export async function assertFilesAttachable(fileIds: string[]): Promise<void> {
    const normalizedIds = normalizeFileIds(fileIds);
    if (normalizedIds.length === 0) {
        return;
    }
    const files = await readManagedFilesByIds(normalizedIds);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const blockedFiles = normalizedIds.filter((fileId) => {
        const lifecycle = fileById.get(fileId)?.app_lifecycle;
        return Boolean(lifecycle && NON_ATTACHABLE_LIFECYCLES.has(lifecycle));
    });
    if (blockedFiles.length > 0) {
        throw new AppError(
            FILE_LIFECYCLE_NOT_ATTACHABLE_CODE,
            "文件处于待删除或隔离状态，不能直接绑定",
            409,
            { fileIds: blockedFiles },
        );
    }
}

export async function markFilesDetached(
    fileIds: string[],
    detachedAt: string,
): Promise<void> {
    await updateLifecycleForFileIds({
        fileIds,
        data: {
            app_lifecycle: "detached",
            app_visibility: "private",
            app_detached_at: detachedAt,
            app_quarantined_at: null,
            app_deleted_at: null,
            app_delete_attempts: 0,
            app_delete_next_retry_at: null,
            app_delete_last_error: null,
            app_delete_dead_lettered_at: null,
        },
    });
}

export async function markFilesQuarantined(
    fileIds: string[],
    quarantinedAt: string,
): Promise<void> {
    await updateLifecycleForFileIds({
        fileIds,
        data: {
            app_lifecycle: "quarantined",
            app_visibility: "private",
            app_quarantined_at: quarantinedAt,
            app_deleted_at: null,
            app_delete_attempts: 0,
            app_delete_next_retry_at: null,
            app_delete_last_error: null,
            app_delete_dead_lettered_at: null,
        },
    });
}

export async function claimFileForQuarantine(params: {
    fileId: string;
    detachedBefore: string;
    quarantinedAt: string;
}): Promise<boolean> {
    const fileId = normalizeDirectusFileId(params.fileId);
    if (!fileId) {
        return false;
    }
    const updated = await withServiceRepositoryContext(
        async () =>
            await updateDirectusFilesByFilter({
                filter: {
                    _and: [
                        { id: { _eq: fileId } },
                        { app_lifecycle: { _eq: "detached" } },
                        { app_detached_at: { _nnull: true } },
                        { app_detached_at: { _lte: params.detachedBefore } },
                    ],
                } as JsonObject,
                data: {
                    app_lifecycle: "quarantined",
                    app_visibility: "private",
                    app_quarantined_at: params.quarantinedAt,
                    app_deleted_at: null,
                    app_delete_attempts: 0,
                    app_delete_next_retry_at: null,
                    app_delete_last_error: null,
                    app_delete_dead_lettered_at: null,
                },
                limit: 1,
                fields: ["id"],
            }),
    );
    return updated.length === 1;
}

export async function markFilesDeleted(
    fileIds: string[],
    deletedAt: string,
): Promise<void> {
    await updateLifecycleForFileIds({
        fileIds,
        data: {
            app_lifecycle: "deleted",
            app_visibility: "private",
            app_deleted_at: deletedAt,
            app_delete_next_retry_at: null,
            app_delete_dead_lettered_at: null,
        },
    });
}

export async function claimFileForDelete(params: {
    fileId: string;
    deletedAt: string;
    retryAfter: string;
    quarantinedBefore: string;
    deleteRetryBefore: string;
}): Promise<boolean> {
    const fileId = normalizeDirectusFileId(params.fileId);
    if (!fileId) {
        return false;
    }
    const retryDueFilter: JsonObject = {
        _or: [
            { app_delete_next_retry_at: { _null: true } },
            {
                app_delete_next_retry_at: {
                    _lte: params.deleteRetryBefore,
                },
            },
        ],
    };
    const updated = await withServiceRepositoryContext(
        async () =>
            await updateDirectusFilesByFilter({
                filter: {
                    _and: [
                        { id: { _eq: fileId } },
                        {
                            _or: [
                                {
                                    _and: [
                                        {
                                            app_lifecycle: {
                                                _eq: "quarantined",
                                            },
                                        },
                                        {
                                            app_quarantined_at: {
                                                _nnull: true,
                                            },
                                        },
                                        {
                                            app_quarantined_at: {
                                                _lte: params.quarantinedBefore,
                                            },
                                        },
                                    ],
                                },
                                {
                                    _and: [
                                        { app_lifecycle: { _eq: "deleted" } },
                                        retryDueFilter,
                                    ],
                                },
                                {
                                    _and: [
                                        { app_lifecycle: { _eq: "deleting" } },
                                        retryDueFilter,
                                    ],
                                },
                            ],
                        },
                    ],
                } as JsonObject,
                data: {
                    app_lifecycle: "deleting",
                    app_visibility: "private",
                    app_deleted_at: params.deletedAt,
                    app_delete_next_retry_at: params.retryAfter,
                    app_delete_dead_lettered_at: null,
                },
                limit: 1,
                fields: ["id"],
            }),
    );
    return updated.length === 1;
}

export async function markFileDeleteRetry(params: {
    fileId: string;
    attempts: number;
    nextRetryAt: string;
    lastError: string;
}): Promise<void> {
    await withServiceRepositoryContext(async () => {
        await updateDirectusFileMetadata(params.fileId, {
            app_lifecycle: "deleted",
            app_visibility: "private",
            app_delete_attempts: params.attempts,
            app_delete_next_retry_at: params.nextRetryAt,
            app_delete_last_error: params.lastError,
            app_delete_dead_lettered_at: null,
        });
    });
}

export async function markFileDeleteDeadLetter(params: {
    fileId: string;
    attempts: number;
    deadLetteredAt: string;
    lastError: string;
}): Promise<void> {
    await withServiceRepositoryContext(async () => {
        await updateDirectusFileMetadata(params.fileId, {
            app_lifecycle: "delete_failed",
            app_visibility: "private",
            app_delete_attempts: params.attempts,
            app_delete_next_retry_at: null,
            app_delete_last_error: params.lastError,
            app_delete_dead_lettered_at: params.deadLetteredAt,
        });
    });
}

export async function readManagedFilesByIds(
    fileIds: string[],
): Promise<AppFile[]> {
    const normalizedIds = normalizeFileIds(fileIds);
    if (normalizedIds.length === 0) {
        return [];
    }
    return await withServiceRepositoryContext(
        async () =>
            (await readMany("directus_files", {
                filter: { id: { _in: normalizedIds } } as JsonObject,
                fields: [...MANAGED_FILE_FIELDS],
                limit: Math.max(normalizedIds.length, 1),
            })) as AppFile[],
    );
}

export async function readAllManagedFiles(): Promise<AppFile[]> {
    const files: AppFile[] = [];
    const limit = 500;
    let offset = 0;

    while (true) {
        const page = await withServiceRepositoryContext(
            async () =>
                (await readMany("directus_files", {
                    fields: [...MANAGED_FILE_FIELDS],
                    limit,
                    offset,
                })) as AppFile[],
        );
        files.push(...page);
        if (page.length < limit) {
            return files;
        }
        offset += limit;
    }
}
