import { createHash } from "node:crypto";

import type { AppFileReference } from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    createOne,
    deleteOne,
    readMany,
    updateOne,
} from "@/server/directus/client";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup-reference-utils";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";

export type FileReferenceKind =
    | "structured_field"
    | "markdown_asset"
    | "settings_asset";

export type FileReferenceVisibility = "private" | "public";

export type FileReferenceOwner = {
    ownerCollection: string;
    ownerId: string;
    ownerField: string;
    referenceKind: FileReferenceKind;
};

export type FileReferenceInput = FileReferenceOwner & {
    fileIds: string[];
    ownerUserId?: string | null;
    visibility: FileReferenceVisibility;
};

export type OwnerFileReferenceRow = Pick<
    AppFileReference,
    | "id"
    | "file_id"
    | "owner_collection"
    | "owner_id"
    | "owner_field"
    | "reference_kind"
    | "owner_user_id"
    | "visibility"
>;

const REFERENCE_PAGE_SIZE = 500;

function toNormalizedText(value: string): string {
    return value.trim();
}

function normalizeOwnerUserId(value: unknown): string | null {
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized || null;
    }
    if (value && typeof value === "object") {
        return normalizeOwnerUserId((value as { id?: unknown }).id);
    }
    return null;
}

function normalizeReferenceFileIds(fileIds: string[]): string[] {
    const normalized = new Set<string>();
    for (const value of fileIds) {
        const fileId = normalizeDirectusFileId(value);
        if (fileId) {
            normalized.add(fileId);
        }
    }
    return [...normalized].sort();
}

export function buildFileReferenceId(
    params: FileReferenceOwner & {
        fileId: string;
    },
): string {
    const source = [
        params.fileId,
        params.ownerCollection,
        params.ownerId,
        params.ownerField,
        params.referenceKind,
    ].join("\u001f");
    const hex = createHash("sha256").update(source).digest("hex");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        `5${hex.slice(13, 16)}`,
        ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
            .toString(16)
            .padStart(2, "0") + hex.slice(18, 20),
        hex.slice(20, 32),
    ].join("-");
}

function buildOwnerFilter(owner: FileReferenceOwner): JsonObject {
    return {
        _and: [
            { owner_collection: { _eq: owner.ownerCollection } },
            { owner_id: { _eq: owner.ownerId } },
            { owner_field: { _eq: owner.ownerField } },
            { reference_kind: { _eq: owner.referenceKind } },
        ],
    } as JsonObject;
}

function toReferencePayload(
    input: FileReferenceInput,
    fileId: string,
    nowIso: string,
): AppFileReference {
    return {
        id: buildFileReferenceId({ ...input, fileId }),
        file_id: fileId,
        owner_collection: input.ownerCollection,
        owner_id: input.ownerId,
        owner_field: input.ownerField,
        reference_kind: input.referenceKind,
        owner_user_id: normalizeOwnerUserId(input.ownerUserId),
        visibility: input.visibility,
        created_at: nowIso,
        updated_at: nowIso,
    };
}

export async function replaceOwnerFieldReferences(
    input: FileReferenceInput,
    now: Date = new Date(),
): Promise<{
    created: number;
    updated: number;
    deleted: number;
    fileIds: string[];
}> {
    const owner: FileReferenceOwner = {
        ownerCollection: toNormalizedText(input.ownerCollection),
        ownerId: toNormalizedText(input.ownerId),
        ownerField: toNormalizedText(input.ownerField),
        referenceKind: input.referenceKind,
    };
    if (!owner.ownerCollection || !owner.ownerId || !owner.ownerField) {
        return { created: 0, updated: 0, deleted: 0, fileIds: [] };
    }

    const fileIds = normalizeReferenceFileIds(input.fileIds);
    const nextById = new Map(
        fileIds.map((fileId) => [
            buildFileReferenceId({ ...owner, fileId }),
            fileId,
        ]),
    );
    const nowIso = now.toISOString();
    const existing = await withServiceRepositoryContext(
        async () =>
            (await readMany("app_file_references", {
                filter: buildOwnerFilter(owner),
                fields: [
                    "id",
                    "file_id",
                    "owner_user_id",
                    "visibility",
                    "created_at",
                    "updated_at",
                ],
                limit: 5000,
            })) as AppFileReference[],
    );

    let created = 0;
    let updated = 0;
    let deleted = 0;
    const existingById = new Map(existing.map((row) => [row.id, row]));
    const ownerUserId = normalizeOwnerUserId(input.ownerUserId);

    for (const [referenceId, fileId] of nextById) {
        const current = existingById.get(referenceId);
        const payload = toReferencePayload(
            {
                ...input,
                ...owner,
                fileIds,
                ownerUserId,
            },
            fileId,
            nowIso,
        );
        if (!current) {
            await withServiceRepositoryContext(async () => {
                await createOne("app_file_references", payload, {
                    fields: ["id"],
                });
            });
            created += 1;
            continue;
        }
        if (
            normalizeOwnerUserId(current.owner_user_id) !== ownerUserId ||
            current.visibility !== input.visibility
        ) {
            await withServiceRepositoryContext(async () => {
                await updateOne("app_file_references", current.id, {
                    owner_user_id: ownerUserId,
                    visibility: input.visibility,
                    updated_at: nowIso,
                });
            });
            updated += 1;
        }
    }

    for (const current of existing) {
        if (!nextById.has(current.id)) {
            await withServiceRepositoryContext(async () => {
                await deleteOne("app_file_references", current.id);
            });
            deleted += 1;
        }
    }

    return { created, updated, deleted, fileIds };
}

export async function deleteOwnerReferences(params: {
    ownerCollection: string;
    ownerId: string;
    ownerField?: string;
    referenceKind?: FileReferenceKind;
}): Promise<number> {
    const conditions: JsonObject[] = [
        { owner_collection: { _eq: params.ownerCollection } } as JsonObject,
        { owner_id: { _eq: params.ownerId } } as JsonObject,
    ];
    if (params.ownerField) {
        conditions.push({
            owner_field: { _eq: params.ownerField },
        } as JsonObject);
    }
    if (params.referenceKind) {
        conditions.push({
            reference_kind: { _eq: params.referenceKind },
        } as JsonObject);
    }

    let deleted = 0;
    while (true) {
        const rows = await withServiceRepositoryContext(
            async () =>
                (await readMany("app_file_references", {
                    filter: { _and: conditions } as JsonObject,
                    fields: ["id"],
                    limit: REFERENCE_PAGE_SIZE,
                })) as Array<{ id: string }>,
        );
        for (const row of rows) {
            await withServiceRepositoryContext(async () => {
                await deleteOne("app_file_references", row.id);
            });
            deleted += 1;
        }
        if (rows.length < REFERENCE_PAGE_SIZE) {
            return deleted;
        }
    }
}

export async function readOwnerFileReferences(params: {
    ownerCollection: string;
    ownerId: string;
}): Promise<OwnerFileReferenceRow[]> {
    const ownerCollection = toNormalizedText(params.ownerCollection);
    const ownerId = toNormalizedText(params.ownerId);
    if (!ownerCollection || !ownerId) {
        return [];
    }
    return await withServiceRepositoryContext(
        async () =>
            (await readMany("app_file_references", {
                filter: {
                    _and: [
                        { owner_collection: { _eq: ownerCollection } },
                        { owner_id: { _eq: ownerId } },
                    ],
                } as JsonObject,
                fields: [
                    "id",
                    "file_id",
                    "owner_collection",
                    "owner_id",
                    "owner_field",
                    "reference_kind",
                    "owner_user_id",
                    "visibility",
                ],
                limit: 5000,
            })) as OwnerFileReferenceRow[],
    );
}

export async function readReferencedFileIdsFromReferenceTable(
    candidateFileIds: string[],
): Promise<Set<string>> {
    const normalized = normalizeReferenceFileIds(candidateFileIds);
    const found = new Set<string>();
    if (normalized.length === 0) {
        return found;
    }
    let offset = 0;
    while (true) {
        const rows = await withServiceRepositoryContext(
            async () =>
                (await readMany("app_file_references", {
                    filter: { file_id: { _in: normalized } } as JsonObject,
                    fields: ["file_id"],
                    limit: REFERENCE_PAGE_SIZE,
                    offset,
                })) as Array<{ file_id: unknown }>,
        );
        for (const row of rows) {
            const fileId = normalizeDirectusFileId(row.file_id);
            if (fileId) {
                found.add(fileId);
            }
        }
        if (
            rows.length < REFERENCE_PAGE_SIZE ||
            found.size >= normalized.length
        ) {
            return found;
        }
        offset += rows.length;
    }
}

export async function readFileReferencesByFileIds(
    candidateFileIds: string[],
): Promise<OwnerFileReferenceRow[]> {
    const normalized = normalizeReferenceFileIds(candidateFileIds);
    if (normalized.length === 0) {
        return [];
    }

    const rows: OwnerFileReferenceRow[] = [];
    let offset = 0;
    while (true) {
        const page = await withServiceRepositoryContext(
            async () =>
                (await readMany("app_file_references", {
                    filter: { file_id: { _in: normalized } } as JsonObject,
                    fields: [
                        "id",
                        "file_id",
                        "owner_collection",
                        "owner_id",
                        "owner_field",
                        "reference_kind",
                        "owner_user_id",
                        "visibility",
                    ],
                    limit: REFERENCE_PAGE_SIZE,
                    offset,
                })) as OwnerFileReferenceRow[],
        );
        rows.push(...page);
        if (page.length < REFERENCE_PAGE_SIZE) {
            return rows;
        }
        offset += page.length;
    }
}

export async function readAllReferencedFileIdsFromReferenceTable(): Promise<
    Set<string>
> {
    const found = new Set<string>();
    let offset = 0;
    while (true) {
        const rows = await withServiceRepositoryContext(
            async () =>
                (await readMany("app_file_references", {
                    fields: ["file_id"],
                    limit: REFERENCE_PAGE_SIZE,
                    offset,
                })) as Array<{ file_id: unknown }>,
        );
        for (const row of rows) {
            const fileId = normalizeDirectusFileId(row.file_id);
            if (fileId) {
                found.add(fileId);
            }
        }
        if (rows.length < REFERENCE_PAGE_SIZE) {
            return found;
        }
        offset += rows.length;
    }
}

export async function countFileReferencesFromRepository(): Promise<number> {
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_file_references", {
                fields: ["id"],
                limit: 1,
            }),
    );
    return rows.length;
}
