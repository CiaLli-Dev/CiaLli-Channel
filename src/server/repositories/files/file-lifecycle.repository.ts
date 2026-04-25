import type { AppFile, AppFileLifecycle } from "@/types/app";
import type { JsonObject } from "@/types/json";

import {
    readMany,
    updateDirectusFileMetadata,
    updateManyItemsByFilter,
} from "@/server/directus/client";
import {
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup-reference-utils";

export type ManagedFileVisibility = "private" | "public";

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
    await updateManyItemsByFilter({
        collection: "directus_files",
        filter: { id: { _in: fileIds } } as JsonObject,
        data: params.data,
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
        },
    });
}

export async function markFilesAttached(params: {
    fileIds: string[];
    ownerUserId?: string | null;
    visibility?: ManagedFileVisibility;
    title?: string;
}): Promise<void> {
    const fileIds = normalizeFileIds(params.fileIds);
    if (fileIds.length === 0) {
        return;
    }
    const lifecyclePayload: JsonObject = {
        app_lifecycle: "attached" satisfies AppFileLifecycle,
        app_detached_at: null,
        app_quarantined_at: null,
        app_deleted_at: null,
    };
    if (params.ownerUserId !== undefined) {
        lifecyclePayload.uploaded_by = params.ownerUserId;
        lifecyclePayload.app_owner_user_id = params.ownerUserId;
    }
    if (params.visibility !== undefined) {
        lifecyclePayload.app_visibility = params.visibility;
    }

    if (fileIds.length === 1) {
        await updateDirectusFileMetadata(fileIds[0], {
            ...(lifecyclePayload as {
                uploaded_by?: string | null;
                app_owner_user_id?: string | null;
                app_visibility?: ManagedFileVisibility;
                app_lifecycle?: AppFileLifecycle;
                app_detached_at?: string | null;
                app_quarantined_at?: string | null;
                app_deleted_at?: string | null;
            }),
            title: params.title?.trim() || undefined,
        });
        return;
    }

    await updateLifecycleForFileIds({
        fileIds,
        data: lifecyclePayload,
    });
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
        },
    });
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
        },
    });
}

export async function readManagedFilesByIds(
    fileIds: string[],
): Promise<AppFile[]> {
    const normalizedIds = normalizeFileIds(fileIds);
    if (normalizedIds.length === 0) {
        return [];
    }
    return (await readMany("directus_files", {
        filter: { id: { _in: normalizedIds } } as JsonObject,
        fields: [
            "id",
            "date_created",
            "date_updated",
            "app_lifecycle",
            "app_detached_at",
            "app_quarantined_at",
            "app_deleted_at",
        ],
        limit: Math.max(normalizedIds.length, 1),
    })) as AppFile[];
}

export async function readAllManagedFiles(): Promise<AppFile[]> {
    const files: AppFile[] = [];
    const limit = 500;
    let offset = 0;

    while (true) {
        const page = (await readMany("directus_files", {
            fields: [
                "id",
                "date_created",
                "date_updated",
                "app_lifecycle",
                "app_detached_at",
                "app_quarantined_at",
                "app_deleted_at",
            ],
            limit,
            offset,
        })) as AppFile[];
        files.push(...page);
        if (page.length < limit) {
            return files;
        }
        offset += limit;
    }
}
