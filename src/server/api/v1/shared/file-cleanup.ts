import type { JsonObject } from "@/types/json";
import { deleteDirectusFile, readMany } from "@/server/directus/client";

const UUID_PATTERN =
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

const REFERENCE_PAGE_SIZE = 200;

type SupportedReferenceCollection =
    | "app_user_profiles"
    | "app_articles"
    | "app_albums"
    | "app_friends"
    | "app_album_photos"
    | "app_diary_images"
    | "app_user_registration_requests"
    | "directus_users";

type ReferenceTarget = {
    collection: SupportedReferenceCollection;
    field: string;
};

const REFERENCE_TARGETS: ReferenceTarget[] = [
    { collection: "app_user_profiles", field: "header_file" },
    { collection: "app_articles", field: "cover_file" },
    { collection: "app_albums", field: "cover_file" },
    { collection: "app_friends", field: "avatar_file" },
    { collection: "app_album_photos", field: "file_id" },
    { collection: "app_diary_images", field: "file_id" },
    { collection: "app_user_registration_requests", field: "avatar_file" },
    { collection: "directus_users", field: "avatar" },
];

function toUuidCandidates(value: string): string[] {
    const hits = value.match(UUID_PATTERN) || [];
    return hits.map((item: string) => item.toLowerCase());
}

export function extractDirectusFileIdsFromUnknown(value: unknown): string[] {
    const found = new Set<string>();

    const walk = (input: unknown): void => {
        if (typeof input === "string") {
            for (const fileId of toUuidCandidates(input)) {
                found.add(fileId);
            }
            return;
        }

        if (Array.isArray(input)) {
            for (const item of input) {
                walk(item);
            }
            return;
        }

        if (input && typeof input === "object") {
            for (const item of Object.values(
                input as Record<string, unknown>,
            )) {
                walk(item);
            }
        }
    };

    walk(value);
    return [...found];
}

export function normalizeDirectusFileId(value: unknown): string | null {
    if (!value) {
        return null;
    }
    if (typeof value === "string") {
        const raw = value.trim();
        if (!raw) {
            return null;
        }
        const candidates = toUuidCandidates(raw);
        return candidates[0] || null;
    }
    if (typeof value === "object") {
        const record = value as { id?: unknown };
        if (typeof record.id === "string") {
            return normalizeDirectusFileId(record.id);
        }
    }
    return null;
}

function toUniqueFileIds(values: unknown[]): string[] {
    const set = new Set<string>();
    for (const value of values) {
        const fileId = normalizeDirectusFileId(value);
        if (fileId) {
            set.add(fileId);
        }
    }
    return [...set];
}

async function collectFileIdsFromCollection(
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

async function collectOwnedDirectusFileIds(userId: string): Promise<string[]> {
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

async function collectDirectusUserAvatarFileIds(
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

async function collectRelationFileIds(
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

async function collectOwnerIds(
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

function collectReferencedIdsFromUnknown(
    value: unknown,
    candidates: Set<string>,
    output: Set<string>,
): void {
    if (output.size >= candidates.size) {
        return;
    }
    if (typeof value === "string") {
        for (const fileId of toUuidCandidates(value)) {
            if (candidates.has(fileId)) {
                output.add(fileId);
            }
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectReferencedIdsFromUnknown(item, candidates, output);
            if (output.size >= candidates.size) {
                return;
            }
        }
        return;
    }
    if (value && typeof value === "object") {
        for (const item of Object.values(value as Record<string, unknown>)) {
            collectReferencedIdsFromUnknown(item, candidates, output);
            if (output.size >= candidates.size) {
                return;
            }
        }
    }
}

async function collectReferencedIdsInSiteSettings(
    fileIds: string[],
): Promise<Set<string>> {
    const candidateSet = new Set(fileIds);
    const referenced = new Set<string>();
    if (candidateSet.size === 0) {
        return referenced;
    }
    const rows = await readMany("app_site_settings", {
        fields: ["settings"],
        limit: 20,
    });
    for (const row of rows as Array<Record<string, unknown>>) {
        collectReferencedIdsFromUnknown(row.settings, candidateSet, referenced);
        if (referenced.size >= candidateSet.size) {
            break;
        }
    }
    return referenced;
}

async function collectReferencedIdsInTarget(
    target: ReferenceTarget,
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

export async function cleanupOrphanDirectusFiles(
    values: unknown[],
): Promise<string[]> {
    const candidateFileIds = toUniqueFileIds(values);
    if (candidateFileIds.length === 0) {
        return [];
    }

    const referencedSet =
        await collectReferencedIdsInSiteSettings(candidateFileIds);
    const unresolved = candidateFileIds.filter((id) => !referencedSet.has(id));
    if (unresolved.length > 0) {
        const matches = await Promise.all(
            REFERENCE_TARGETS.map((target) =>
                collectReferencedIdsInTarget(target, unresolved),
            ),
        );
        for (const result of matches) {
            for (const id of result) {
                referencedSet.add(id);
            }
        }
    }

    const orphanFileIds = candidateFileIds.filter(
        (id) => !referencedSet.has(id),
    );
    for (const fileId of orphanFileIds) {
        await deleteDirectusFile(fileId);
    }
    return orphanFileIds;
}

export async function collectDiaryFileIds(diaryId: string): Promise<string[]> {
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

export async function collectAlbumFileIds(
    albumId: string,
    coverFile?: unknown,
): Promise<string[]> {
    const rows = await readMany("app_album_photos", {
        filter: { album_id: { _eq: albumId } } as JsonObject,
        fields: ["file_id"],
        limit: 5000,
    });
    const values = (rows as Array<Record<string, unknown>>).map(
        (row) => row.file_id,
    );
    if (coverFile !== undefined) {
        values.push(coverFile);
    }
    return toUniqueFileIds(values);
}

export async function collectUserOwnedFileIds(
    userId: string,
): Promise<string[]> {
    const [
        profileHeaderFiles,
        directusAvatarFiles,
        articleCoverFiles,
        albumCoverFiles,
    ] = await Promise.all([
        collectFileIdsFromCollection("app_user_profiles", "header_file", {
            user_id: { _eq: userId },
        } as JsonObject),
        collectDirectusUserAvatarFileIds(userId),
        collectFileIdsFromCollection("app_articles", "cover_file", {
            author_id: { _eq: userId },
        } as JsonObject),
        collectFileIdsFromCollection("app_albums", "cover_file", {
            author_id: { _eq: userId },
        } as JsonObject),
    ]);
    const [registrationAvatarFiles, uploadedByFiles] = await Promise.all([
        collectFileIdsFromCollection(
            "app_user_registration_requests",
            "avatar_file",
            {
                approved_user_id: { _eq: userId },
            } as JsonObject,
        ),
        collectOwnedDirectusFileIds(userId),
    ]);

    const [albumIds, diaryIds] = await Promise.all([
        collectOwnerIds("app_albums", "author_id", userId),
        collectOwnerIds("app_diaries", "author_id", userId),
    ]);

    const [albumPhotoFiles, diaryImageFiles] = await Promise.all([
        collectRelationFileIds("app_album_photos", "album_id", albumIds),
        collectRelationFileIds("app_diary_images", "diary_id", diaryIds),
    ]);

    return toUniqueFileIds([
        ...profileHeaderFiles,
        ...directusAvatarFiles,
        ...articleCoverFiles,
        ...albumCoverFiles,
        ...registrationAvatarFiles,
        ...uploadedByFiles,
        ...albumPhotoFiles,
        ...diaryImageFiles,
    ]);
}
