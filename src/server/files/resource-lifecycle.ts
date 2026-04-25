import type {
    AppFileReferenceKind,
    AppFileReferenceVisibility,
    ResourceReferenceSyncJobPayload,
} from "@/types/app";
import { AppError } from "@/server/api/errors";
import { createOne, updateOne } from "@/server/directus/client";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup-reference-utils";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import {
    assertFilesAttachable,
    FILE_LIFECYCLE_NOT_ATTACHABLE_CODE,
    markFilesAttached,
    markFilesDetached,
    readManagedFilesByIds,
} from "@/server/repositories/files/file-lifecycle.repository";
import {
    readFileReferencesByFileIds,
    readOwnerFileReferences,
    replaceOwnerFieldReferences,
    type OwnerFileReferenceRow,
} from "@/server/repositories/files/file-reference.repository";
import { readOwnerSourceReferencedFileIdsFromRepository } from "@/server/repositories/files/file-cleanup.repository";

export type ResourceLifecycleReferenceInput = {
    ownerField: string;
    referenceKind: AppFileReferenceKind;
    fileIds: string[];
};

export type SyncOwnerReferencesInput = {
    ownerCollection: string;
    ownerId: string;
    ownerUserId?: string | null;
    visibility: AppFileReferenceVisibility;
    references: ResourceLifecycleReferenceInput[];
};

export type SyncOwnerReferencesResult = {
    attachedFileIds: string[];
    detachedFileIds: string[];
    currentFileIds: string[];
};

export type ReleaseOwnerResourcesInput = {
    ownerCollection: string;
    ownerId: string;
};

export type ReleaseOwnerResourcesResult = {
    jobId: string;
    status: "pending" | "skipped";
    candidateFileIds: string[];
    deletedReferences: number;
};

export type RestoreQuarantinedFilesInput = {
    fileIds: string[];
    requireReference?: boolean;
};

export type RestoreQuarantinedFilesResult = {
    requestedFileIds: string[];
    restoredFileIds: string[];
    skippedMissingFileIds: string[];
    skippedNotQuarantinedFileIds: string[];
    skippedUnreferencedFileIds: string[];
};

const RESOURCE_REFERENCE_SYNC_SOURCE_TYPE = "resource.references.sync";

function normalizeText(value: unknown): string {
    return String(value ?? "").trim();
}

function normalizeOwnerUserId(value: unknown): string | null {
    if (typeof value === "string") {
        return value.trim() || null;
    }
    if (value && typeof value === "object") {
        return normalizeOwnerUserId((value as { id?: unknown }).id);
    }
    return null;
}

function normalizeFileIds(values: unknown[]): string[] {
    const fileIds = new Set<string>();
    for (const value of values) {
        const fileId = normalizeDirectusFileId(value);
        if (fileId) {
            fileIds.add(fileId);
        }
    }
    return [...fileIds].sort();
}

function buildReferenceKey(reference: {
    ownerField: string;
    referenceKind: AppFileReferenceKind;
}): string {
    return `${reference.ownerField}\u001f${reference.referenceKind}`;
}

function normalizeSyncInput(
    input: SyncOwnerReferencesInput,
): ResourceReferenceSyncJobPayload | null {
    const ownerCollection = normalizeText(input.ownerCollection);
    const ownerId = normalizeText(input.ownerId);
    if (!ownerCollection || !ownerId) {
        return null;
    }
    return {
        ownerCollection,
        ownerId,
        ownerUserId: normalizeOwnerUserId(input.ownerUserId),
        visibility: input.visibility,
        references: input.references
            .map((reference) => ({
                ownerField: normalizeText(reference.ownerField),
                referenceKind: reference.referenceKind,
                fileIds: normalizeFileIds(reference.fileIds),
            }))
            .filter((reference) => reference.ownerField),
    };
}

function readFileIds(rows: OwnerFileReferenceRow[]): string[] {
    return normalizeFileIds(rows.map((row) => row.file_id));
}

function groupReferencesByFileId(
    rows: OwnerFileReferenceRow[],
): Map<string, OwnerFileReferenceRow[]> {
    const grouped = new Map<string, OwnerFileReferenceRow[]>();
    for (const row of rows) {
        const fileId = normalizeDirectusFileId(row.file_id);
        if (!fileId) {
            continue;
        }
        const existing = grouped.get(fileId) || [];
        existing.push(row);
        grouped.set(fileId, existing);
    }
    return grouped;
}

function readRestoreOwnerUserId(
    rows: OwnerFileReferenceRow[],
): string | null | undefined {
    for (const row of rows) {
        const ownerUserId = normalizeOwnerUserId(row.owner_user_id);
        if (ownerUserId) {
            return ownerUserId;
        }
    }
    return rows.length > 0 ? null : undefined;
}

function readRestoreVisibility(
    rows: OwnerFileReferenceRow[],
): AppFileReferenceVisibility | undefined {
    if (rows.length === 0) {
        return undefined;
    }
    return rows.some((row) => row.visibility === "public")
        ? "public"
        : "private";
}

function buildCurrentOwnerFileIds(params: {
    previousRows: OwnerFileReferenceRow[];
    updatedReferenceKeys: Set<string>;
    nextFileIds: string[];
}): string[] {
    const current = new Set<string>(params.nextFileIds);
    for (const row of params.previousRows) {
        if (
            params.updatedReferenceKeys.has(
                buildReferenceKey({
                    ownerField: row.owner_field,
                    referenceKind: row.reference_kind,
                }),
            )
        ) {
            continue;
        }
        const fileId = normalizeDirectusFileId(row.file_id);
        if (fileId) {
            current.add(fileId);
        }
    }
    return [...current].sort();
}

function diffRemovedFileIds(params: {
    previousFileIds: string[];
    currentFileIds: string[];
}): string[] {
    const current = new Set(params.currentFileIds);
    return params.previousFileIds.filter((fileId) => !current.has(fileId));
}

async function enqueueResourceReferenceSyncJob(
    payload: ResourceReferenceSyncJobPayload,
): Promise<string> {
    const now = new Date().toISOString();
    const created = await withServiceRepositoryContext(
        async () =>
            await createOne(
                "app_file_detach_jobs",
                {
                    status: "pending",
                    source_type: RESOURCE_REFERENCE_SYNC_SOURCE_TYPE,
                    source_id: payload.ownerId,
                    candidate_file_ids: payload,
                    detached_file_ids: [],
                    skipped_referenced_file_ids: [],
                    attempts: 0,
                    scheduled_at: now,
                    leased_until: null,
                    started_at: null,
                    finished_at: null,
                    error_code: null,
                    error_message: null,
                },
                { fields: ["id"] },
            ),
    );
    return created.id;
}

async function enqueueOwnerReleaseJob(params: {
    ownerCollection: string;
    ownerId: string;
    candidateFileIds: string[];
}): Promise<{ jobId: string; status: "pending" | "skipped" }> {
    const now = new Date().toISOString();
    const status = params.candidateFileIds.length > 0 ? "pending" : "skipped";
    const created = await withServiceRepositoryContext(
        async () =>
            await createOne(
                "app_file_detach_jobs",
                {
                    status,
                    source_type: `resource.owner.release:${params.ownerCollection}`,
                    source_id: params.ownerId,
                    candidate_file_ids: params.candidateFileIds,
                    detached_file_ids: [],
                    skipped_referenced_file_ids: [],
                    attempts: 0,
                    scheduled_at: status === "pending" ? now : null,
                    leased_until: null,
                    started_at: null,
                    finished_at: status === "skipped" ? now : null,
                    error_code: null,
                    error_message: null,
                },
                { fields: ["id", "status"] },
            ),
    );
    return { jobId: created.id, status };
}

async function syncOwnerReferencesStrict(
    input: SyncOwnerReferencesInput,
): Promise<SyncOwnerReferencesResult> {
    const normalized = normalizeSyncInput(input);
    if (!normalized) {
        return {
            attachedFileIds: [],
            detachedFileIds: [],
            currentFileIds: [],
        };
    }

    const previousRows = await readOwnerFileReferences(normalized);
    const previousFileIds = readFileIds(previousRows);
    const updatedReferenceKeys = new Set(
        normalized.references.map((reference) => buildReferenceKey(reference)),
    );
    const nextFileIds = normalizeFileIds(
        normalized.references.flatMap((reference) => reference.fileIds),
    );

    await assertFilesAttachable(nextFileIds);

    for (const reference of normalized.references) {
        await replaceOwnerFieldReferences({
            ownerCollection: normalized.ownerCollection,
            ownerId: normalized.ownerId,
            ownerField: reference.ownerField,
            referenceKind: reference.referenceKind,
            fileIds: reference.fileIds,
            ownerUserId: normalized.ownerUserId,
            visibility: normalized.visibility,
        });
    }

    const currentFileIds = buildCurrentOwnerFileIds({
        previousRows,
        updatedReferenceKeys,
        nextFileIds,
    });
    const detachedFileIds = diffRemovedFileIds({
        previousFileIds,
        currentFileIds,
    });

    await markFilesAttached({
        fileIds: nextFileIds,
        ownerUserId: normalized.ownerUserId,
        visibility: normalized.visibility,
    });

    const remainingDetachedReferences =
        await readFileReferencesByFileIds(detachedFileIds);
    const remainingReferencesByFileId = groupReferencesByFileId(
        remainingDetachedReferences,
    );
    const globallyDetachedFileIds = detachedFileIds.filter(
        (fileId) => !remainingReferencesByFileId.has(fileId),
    );
    const stillReferencedFileIds = detachedFileIds.filter((fileId) =>
        remainingReferencesByFileId.has(fileId),
    );

    await markFilesDetached(globallyDetachedFileIds, new Date().toISOString());
    for (const fileId of stillReferencedFileIds) {
        const fileReferences = remainingReferencesByFileId.get(fileId) || [];
        await markFilesAttached({
            fileIds: [fileId],
            ownerUserId: readRestoreOwnerUserId(fileReferences),
            visibility: readRestoreVisibility(fileReferences),
            allowLifecycleOverride: true,
        });
    }

    return {
        attachedFileIds: nextFileIds,
        detachedFileIds: globallyDetachedFileIds,
        currentFileIds,
    };
}

async function syncOwnerReferences(
    input: SyncOwnerReferencesInput,
): Promise<SyncOwnerReferencesResult> {
    const normalized = normalizeSyncInput(input);
    if (!normalized) {
        return {
            attachedFileIds: [],
            detachedFileIds: [],
            currentFileIds: [],
        };
    }
    try {
        return await syncOwnerReferencesStrict(normalized);
    } catch (error) {
        if (
            error instanceof AppError &&
            error.code === FILE_LIFECYCLE_NOT_ATTACHABLE_CODE
        ) {
            throw error;
        }
        try {
            await enqueueResourceReferenceSyncJob(normalized);
            return {
                attachedFileIds: normalizeFileIds(
                    normalized.references.flatMap(
                        (reference) => reference.fileIds,
                    ),
                ),
                detachedFileIds: [],
                currentFileIds: [],
            };
        } catch (enqueueError) {
            console.error(
                "[resource-lifecycle] sync compensation enqueue failed",
                {
                    ownerCollection: normalized.ownerCollection,
                    ownerId: normalized.ownerId,
                    error:
                        enqueueError instanceof Error
                            ? enqueueError.message
                            : String(enqueueError),
                    originalError:
                        error instanceof Error ? error.message : String(error),
                },
            );
            throw error;
        }
    }
}

async function releaseOwnerResources(
    input: ReleaseOwnerResourcesInput,
): Promise<ReleaseOwnerResourcesResult> {
    const ownerCollection = normalizeText(input.ownerCollection);
    const ownerId = normalizeText(input.ownerId);
    if (!ownerCollection || !ownerId) {
        return {
            jobId: "",
            status: "skipped",
            candidateFileIds: [],
            deletedReferences: 0,
        };
    }

    const [rows, sourceFileIds] = await Promise.all([
        readOwnerFileReferences({ ownerCollection, ownerId }),
        readOwnerSourceReferencedFileIdsFromRepository({
            ownerCollection,
            ownerId,
        }),
    ]);
    const candidateFileIds = normalizeFileIds([
        ...readFileIds(rows),
        ...sourceFileIds,
    ]);
    const job = await enqueueOwnerReleaseJob({
        ownerCollection,
        ownerId,
        candidateFileIds,
    });
    return {
        ...job,
        candidateFileIds,
        deletedReferences: 0,
    };
}

async function restoreQuarantinedFiles(
    input: RestoreQuarantinedFilesInput,
): Promise<RestoreQuarantinedFilesResult> {
    const requestedFileIds = normalizeFileIds(input.fileIds);
    const result: RestoreQuarantinedFilesResult = {
        requestedFileIds,
        restoredFileIds: [],
        skippedMissingFileIds: [],
        skippedNotQuarantinedFileIds: [],
        skippedUnreferencedFileIds: [],
    };
    if (requestedFileIds.length === 0) {
        return result;
    }

    const [files, references] = await Promise.all([
        readManagedFilesByIds(requestedFileIds),
        readFileReferencesByFileIds(requestedFileIds),
    ]);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const referencesByFileId = groupReferencesByFileId(references);

    for (const fileId of requestedFileIds) {
        const file = fileById.get(fileId);
        if (!file) {
            result.skippedMissingFileIds.push(fileId);
            continue;
        }
        if (file.app_lifecycle !== "quarantined") {
            result.skippedNotQuarantinedFileIds.push(fileId);
            continue;
        }

        const fileReferences = referencesByFileId.get(fileId) || [];
        if (input.requireReference !== false && fileReferences.length === 0) {
            result.skippedUnreferencedFileIds.push(fileId);
            continue;
        }

        await markFilesAttached({
            fileIds: [fileId],
            ownerUserId: readRestoreOwnerUserId(fileReferences),
            visibility: readRestoreVisibility(fileReferences),
            allowLifecycleOverride: true,
        });
        result.restoredFileIds.push(fileId);
    }

    return result;
}

export function isResourceReferenceSyncJobSource(sourceType: string): boolean {
    return sourceType === RESOURCE_REFERENCE_SYNC_SOURCE_TYPE;
}

export function parseResourceReferenceSyncJobPayload(
    value: unknown,
): ResourceReferenceSyncJobPayload | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const candidate = value as {
        ownerCollection?: unknown;
        ownerId?: unknown;
        ownerUserId?: unknown;
        visibility?: unknown;
        references?: unknown;
    };
    if (
        candidate.visibility !== "private" &&
        candidate.visibility !== "public"
    ) {
        return null;
    }
    if (!Array.isArray(candidate.references)) {
        return null;
    }
    return normalizeSyncInput({
        ownerCollection: normalizeText(candidate.ownerCollection),
        ownerId: normalizeText(candidate.ownerId),
        ownerUserId: normalizeOwnerUserId(candidate.ownerUserId),
        visibility: candidate.visibility,
        references: candidate.references.flatMap((reference) => {
            if (
                !reference ||
                typeof reference !== "object" ||
                Array.isArray(reference)
            ) {
                return [];
            }
            const row = reference as {
                ownerField?: unknown;
                referenceKind?: unknown;
                fileIds?: unknown;
            };
            if (
                row.referenceKind !== "structured_field" &&
                row.referenceKind !== "markdown_asset" &&
                row.referenceKind !== "settings_asset"
            ) {
                return [];
            }
            return [
                {
                    ownerField: normalizeText(row.ownerField),
                    referenceKind: row.referenceKind,
                    fileIds: Array.isArray(row.fileIds) ? row.fileIds : [],
                },
            ];
        }),
    });
}

export async function replayResourceReferenceSyncJob(
    payload: ResourceReferenceSyncJobPayload,
): Promise<SyncOwnerReferencesResult> {
    return await syncOwnerReferencesStrict(payload);
}

export async function markResourceReferenceSyncJobSucceeded(params: {
    jobId: string;
    nowIso: string;
}): Promise<void> {
    await withServiceRepositoryContext(async () => {
        await updateOne("app_file_detach_jobs", params.jobId, {
            status: "succeeded",
            scheduled_at: null,
            leased_until: null,
            finished_at: params.nowIso,
            detached_file_ids: [],
            skipped_referenced_file_ids: [],
            error_code: null,
            error_message: null,
        });
    });
}

export const resourceLifecycle = {
    syncOwnerReferences,
    releaseOwnerResources,
    restoreQuarantinedFiles,
};
