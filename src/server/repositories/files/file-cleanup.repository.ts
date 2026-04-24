import type { UploadPurpose } from "@/constants/upload-limits";
import type { JsonObject } from "@/types/json";
import { deleteDirectusFile, readMany } from "@/server/directus/client";
import {
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
    toUniqueFileIds,
} from "@/server/api/v1/shared/file-cleanup-reference-utils";

export const REFERENCE_PAGE_SIZE = 200;

type SupportedReferenceCollection =
    | "app_user_profiles"
    | "app_articles"
    | "app_albums"
    | "app_anime_entries"
    | "app_friends"
    | "app_album_photos"
    | "app_diary_images"
    | "app_user_registration_requests"
    | "directus_users";

export type StructuredReferenceTarget = {
    collection: SupportedReferenceCollection;
    field: string;
};

export type MarkdownReferenceTarget = {
    collection:
        | "app_articles"
        | "app_article_comments"
        | "app_diary_comments"
        | "app_diaries";
    field: "body_markdown" | "body" | "content";
};

export const STRUCTURED_REFERENCE_TARGETS: StructuredReferenceTarget[] = [
    { collection: "app_user_profiles", field: "header_file" },
    { collection: "app_articles", field: "cover_file" },
    { collection: "app_albums", field: "cover_file" },
    { collection: "app_anime_entries", field: "cover_file" },
    { collection: "app_friends", field: "avatar_file" },
    { collection: "app_album_photos", field: "file_id" },
    { collection: "app_diary_images", field: "file_id" },
    { collection: "app_user_registration_requests", field: "avatar_file" },
    { collection: "directus_users", field: "avatar" },
];

export const MARKDOWN_REFERENCE_TARGETS: MarkdownReferenceTarget[] = [
    { collection: "app_articles", field: "body_markdown" },
    { collection: "app_article_comments", field: "body" },
    { collection: "app_diary_comments", field: "body" },
    { collection: "app_diaries", field: "content" },
];

export function collectReferencedAssetIdsFromUnknown(
    value: unknown,
    candidates: Set<string>,
    output: Set<string>,
): void {
    if (output.size >= candidates.size) {
        return;
    }
    if (typeof value === "string") {
        const found = extractDirectusAssetIdsFromMarkdown(value);
        for (const fileId of found) {
            if (candidates.has(fileId)) {
                output.add(fileId);
            }
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectReferencedAssetIdsFromUnknown(item, candidates, output);
            if (output.size >= candidates.size) {
                return;
            }
        }
        return;
    }
    if (value && typeof value === "object") {
        for (const item of Object.values(value as Record<string, unknown>)) {
            collectReferencedAssetIdsFromUnknown(item, candidates, output);
            if (output.size >= candidates.size) {
                return;
            }
        }
    }
}

export async function readFileIdsFromCollectionFieldFromRepository(
    collection:
        | "app_user_profiles"
        | "app_articles"
        | "app_albums"
        | "app_friends"
        | "app_user_registration_requests",
    field: "avatar_file" | "cover_file" | "header_file",
    filter: JsonObject,
): Promise<string[]> {
    const rows = await readMany(collection, {
        filter,
        fields: [field],
        limit: 2000,
    });
    const values = (rows as Array<Record<string, unknown>>).map(
        (row) => row[field],
    );
    return toUniqueFileIds(values);
}

export async function readOwnedDirectusFileIdsFromRepository(
    userId: string,
): Promise<string[]> {
    try {
        const rows = await readMany("directus_files", {
            filter: { uploaded_by: { _eq: userId } } as JsonObject,
            fields: ["id"],
            limit: 5000,
        });
        return toUniqueFileIds(
            (rows as Array<Record<string, unknown>>).map((row) => row.id),
        );
    } catch (error) {
        const message = String(error);
        if (/forbidden|permission/i.test(message)) {
            console.warn(
                "[file-cleanup] skip collectOwnedDirectusFileIds due to permission:",
                message,
            );
            return [];
        }
        throw error;
    }
}

export async function readDirectusUserAvatarFileIdsFromRepository(
    userId: string,
): Promise<string[]> {
    const rows = await readMany("directus_users", {
        filter: { id: { _eq: userId } } as JsonObject,
        fields: ["avatar"],
        limit: 1,
    });
    return toUniqueFileIds(
        (rows as Array<Record<string, unknown>>).map((row) => row.avatar),
    );
}

export async function readRelationFileIdsFromRepository(
    collection: "app_album_photos" | "app_diary_images",
    filterField: "album_id" | "diary_id",
    ownerIds: string[],
): Promise<string[]> {
    if (ownerIds.length === 0) {
        return [];
    }
    const rows = await readMany(collection, {
        filter: { [filterField]: { _in: ownerIds } } as JsonObject,
        fields: ["file_id"],
        limit: 5000,
    });
    const values = (rows as Array<Record<string, unknown>>).map(
        (row) => row.file_id,
    );
    return toUniqueFileIds(values);
}

export async function readOwnerIdsFromRepository(
    collection: "app_albums" | "app_diaries",
    ownerField: "author_id",
    ownerId: string,
): Promise<string[]> {
    const rows = await readMany(collection, {
        filter: { [ownerField]: { _eq: ownerId } } as JsonObject,
        fields: ["id"],
        limit: 2000,
    });
    return (rows as Array<Record<string, unknown>>)
        .map((row) => String(row.id || "").trim())
        .filter(Boolean);
}

export async function readReferencedIdsInSiteSettingsFromRepository(
    fileIds: string[],
): Promise<Set<string>> {
    const candidateSet = new Set(fileIds);
    const referenced = new Set<string>();
    if (candidateSet.size === 0) {
        return referenced;
    }
    const rows = await readMany("app_site_settings", {
        filter: {
            _and: [
                { key: { _eq: "default" } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject,
        fields: ["settings"],
        sort: ["-date_updated", "-date_created"],
        limit: 1,
    });
    for (const row of rows as Array<Record<string, unknown>>) {
        collectReferencedAssetIdsFromUnknown(
            row.settings,
            candidateSet,
            referenced,
        );
        if (referenced.size >= candidateSet.size) {
            break;
        }
    }
    return referenced;
}

export async function readReferencedIdsInStructuredTargetFromRepository(
    target: StructuredReferenceTarget,
    fileIds: string[],
): Promise<Set<string>> {
    const found = new Set<string>();
    if (fileIds.length === 0) {
        return found;
    }
    let offset = 0;
    while (true) {
        const rows = await readMany(target.collection, {
            filter: { [target.field]: { _in: fileIds } } as JsonObject,
            fields: [target.field],
            limit: REFERENCE_PAGE_SIZE,
            offset,
        });
        const list = rows as Array<Record<string, unknown>>;
        for (const row of list) {
            const fileId = normalizeDirectusFileId(row[target.field]);
            if (fileId) {
                found.add(fileId);
            }
        }
        if (list.length < REFERENCE_PAGE_SIZE || found.size >= fileIds.length) {
            break;
        }
        offset += list.length;
    }
    return found;
}

export async function readReferencedIdsInMarkdownTargetFromRepository(
    target: MarkdownReferenceTarget,
    fileIds: string[],
): Promise<Set<string>> {
    const candidateSet = new Set(fileIds);
    const found = new Set<string>();
    if (candidateSet.size === 0) {
        return found;
    }

    let offset = 0;
    while (true) {
        const rows = await readMany(target.collection, {
            fields: [target.field],
            limit: REFERENCE_PAGE_SIZE,
            offset,
        });
        const list = rows as Array<Record<string, unknown>>;
        for (const row of list) {
            collectReferencedAssetIdsFromUnknown(
                row[target.field],
                candidateSet,
                found,
            );
            if (found.size >= candidateSet.size) {
                return found;
            }
        }
        if (list.length < REFERENCE_PAGE_SIZE) {
            break;
        }
        offset += list.length;
    }
    return found;
}

function normalizeOwnerId(value: unknown): string | null {
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized || null;
    }
    if (value && typeof value === "object") {
        const record = value as { id?: unknown };
        return normalizeOwnerId(record.id);
    }
    return null;
}

export async function readDeletableOwnedFilesFromRepository(
    candidateFileIds: string[],
    allowedOwnerIds: Set<string>,
): Promise<string[]> {
    if (candidateFileIds.length === 0) {
        return [];
    }
    if (allowedOwnerIds.size === 0) {
        return [...candidateFileIds];
    }

    const rows = await readMany("directus_files", {
        filter: { id: { _in: candidateFileIds } } as JsonObject,
        fields: ["id", "uploaded_by", "app_owner_user_id"],
        limit: 5000,
    });
    const deletable = new Set<string>();

    for (const row of rows as Array<Record<string, unknown>>) {
        const fileId = normalizeDirectusFileId(row.id);
        if (!fileId) {
            continue;
        }
        const ownerId =
            normalizeOwnerId(row.app_owner_user_id) ||
            normalizeOwnerId(row.uploaded_by);
        if (ownerId && allowedOwnerIds.has(ownerId)) {
            deletable.add(fileId);
        }
    }

    return candidateFileIds.filter((fileId) => deletable.has(fileId));
}

export async function readStaleFileGcCandidatesFromRepository(params: {
    createdBefore: string;
    temporaryPurposes: UploadPurpose[];
    limit: number;
}): Promise<
    Array<{
        id: string;
        date_created: string | null;
        app_owner_user_id?: unknown;
        app_upload_purpose?: unknown;
    }>
> {
    const rows = await readMany("directus_files", {
        filter: {
            _and: [
                { date_created: { _lte: params.createdBefore } },
                {
                    _or: [
                        { app_owner_user_id: { _null: true } },
                        {
                            app_upload_purpose: {
                                _in: params.temporaryPurposes,
                            },
                        },
                    ],
                },
            ],
        } as JsonObject,
        fields: [
            "id",
            "date_created",
            "app_owner_user_id",
            "app_upload_purpose",
        ],
        sort: ["date_created", "id"],
        limit: params.limit,
    });

    return rows as Array<{
        id: string;
        date_created: string | null;
        app_owner_user_id?: unknown;
        app_upload_purpose?: unknown;
    }>;
}

function normalizeOwnerIds(values: unknown[]): string[] {
    const ownerIds = new Set<string>();
    for (const value of values) {
        const ownerId = normalizeOwnerId(value);
        if (ownerId) {
            ownerIds.add(ownerId);
        }
    }
    return [...ownerIds];
}

export async function readCommentCleanupCandidatesFromRepository(
    collection: "app_article_comments" | "app_diary_comments",
    relationField: "article_id" | "diary_id",
    relationId: string,
): Promise<{ candidateFileIds: string[]; ownerUserIds: string[] }> {
    const rows = await readMany(collection, {
        filter: { [relationField]: { _eq: relationId } } as JsonObject,
        fields: ["body", "author_id"],
        limit: 5000,
    });
    const candidateFileIds: string[] = [];
    const ownerUserIds: string[] = [];

    for (const row of rows as Array<Record<string, unknown>>) {
        candidateFileIds.push(
            ...extractDirectusAssetIdsFromMarkdown(String(row.body ?? "")),
        );
        ownerUserIds.push(String(row.author_id ?? ""));
    }

    return {
        candidateFileIds: toUniqueFileIds(candidateFileIds),
        ownerUserIds: normalizeOwnerIds(ownerUserIds),
    };
}

export async function readDiaryImageFileIdsFromRepository(
    diaryId: string,
): Promise<string[]> {
    const imageRows = await readMany("app_diary_images", {
        filter: { diary_id: { _eq: diaryId } } as JsonObject,
        fields: ["file_id"],
        limit: 5000,
    });
    const values = (imageRows as Array<Record<string, unknown>>).map(
        (row) => row.file_id,
    );
    return toUniqueFileIds(values);
}

export async function readAlbumPhotoFileIdsFromRepository(
    albumId: string,
): Promise<string[]> {
    const rows = await readMany("app_album_photos", {
        filter: { album_id: { _eq: albumId } } as JsonObject,
        fields: ["file_id"],
        limit: 5000,
    });
    const values = (rows as Array<Record<string, unknown>>).map(
        (row) => row.file_id,
    );
    return toUniqueFileIds(values);
}

export async function deleteOrphanFileFromRepository(
    fileId: string,
): Promise<void> {
    await deleteDirectusFile(fileId);
}
