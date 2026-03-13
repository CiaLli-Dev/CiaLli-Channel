import type { JsonObject } from "@/types/json";
import {
    deleteDirectusFile,
    readMany,
    runWithDirectusServiceAccess,
} from "@/server/directus/client";
import {
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
    toUniqueFileIds,
} from "@/server/api/v1/shared/file-cleanup-reference-utils";

export {
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup-reference-utils";

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

type StructuredReferenceTarget = {
    collection: SupportedReferenceCollection;
    field: string;
};

type MarkdownReferenceTarget = {
    collection:
        | "app_articles"
        | "app_article_comments"
        | "app_diary_comments"
        | "app_diaries";
    field: "body_markdown" | "body" | "content";
};

export type DirectusFileCleanupRequest = {
    candidateFileIds: string[];
    ownerUserIds?: string[];
};

export type DirectusFileCleanupCandidates = {
    candidateFileIds: string[];
    ownerUserIds: string[];
};

const STRUCTURED_REFERENCE_TARGETS: StructuredReferenceTarget[] = [
    { collection: "app_user_profiles", field: "header_file" },
    { collection: "app_articles", field: "cover_file" },
    { collection: "app_albums", field: "cover_file" },
    { collection: "app_friends", field: "avatar_file" },
    { collection: "app_album_photos", field: "file_id" },
    { collection: "app_diary_images", field: "file_id" },
    { collection: "app_user_registration_requests", field: "avatar_file" },
    { collection: "directus_users", field: "avatar" },
];

const MARKDOWN_REFERENCE_TARGETS: MarkdownReferenceTarget[] = [
    { collection: "app_articles", field: "body_markdown" },
    { collection: "app_article_comments", field: "body" },
    { collection: "app_diary_comments", field: "body" },
    { collection: "app_diaries", field: "content" },
];

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

export function mergeDirectusFileCleanupCandidates(
    ...groups: DirectusFileCleanupCandidates[]
): DirectusFileCleanupCandidates {
    const candidateFileIds = new Set<string>();
    const ownerUserIds = new Set<string>();

    for (const group of groups) {
        for (const fileId of toUniqueFileIds(group.candidateFileIds)) {
            candidateFileIds.add(fileId);
        }
        for (const ownerUserId of normalizeOwnerIds(group.ownerUserIds)) {
            ownerUserIds.add(ownerUserId);
        }
    }

    return {
        candidateFileIds: [...candidateFileIds],
        ownerUserIds: [...ownerUserIds],
    };
}

function collectReferencedAssetIdsFromUnknown(
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

async function collectReferencedIdsInStructuredTarget(
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

async function collectReferencedIdsInMarkdownTarget(
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

async function collectDeletableOwnedFileIds(
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

async function collectReferencedDirectusFileIdsInternal(
    candidateFileIds: string[],
): Promise<Set<string>> {
    const normalizedCandidateIds = toUniqueFileIds(candidateFileIds);
    const referencedSet = await collectReferencedIdsInSiteSettings(
        normalizedCandidateIds,
    );
    const unresolved = normalizedCandidateIds.filter(
        (id) => !referencedSet.has(id),
    );
    if (unresolved.length === 0) {
        return referencedSet;
    }

    const [structuredMatches, markdownMatches] = await Promise.all([
        Promise.all(
            STRUCTURED_REFERENCE_TARGETS.map((target) =>
                collectReferencedIdsInStructuredTarget(target, unresolved),
            ),
        ),
        Promise.all(
            MARKDOWN_REFERENCE_TARGETS.map((target) =>
                collectReferencedIdsInMarkdownTarget(target, unresolved),
            ),
        ),
    ]);

    for (const result of [...structuredMatches, ...markdownMatches]) {
        for (const id of result) {
            referencedSet.add(id);
        }
    }

    return referencedSet;
}

export async function collectReferencedDirectusFileIds(
    candidateFileIds: string[],
): Promise<Set<string>> {
    return await runWithDirectusServiceAccess(async () =>
        collectReferencedDirectusFileIdsInternal(candidateFileIds),
    );
}

export async function cleanupOwnedOrphanDirectusFiles(
    request: DirectusFileCleanupRequest,
): Promise<string[]> {
    const candidateFileIds = toUniqueFileIds(request.candidateFileIds);
    if (candidateFileIds.length === 0) {
        return [];
    }

    return await runWithDirectusServiceAccess(async () => {
        const allowedOwnerIds = new Set(
            normalizeOwnerIds(request.ownerUserIds ?? []),
        );
        // 文件清理需要访问 directus_files 并执行物理删除，统一提升到 service 作用域。
        const ownedCandidateIds = await collectDeletableOwnedFileIds(
            candidateFileIds,
            allowedOwnerIds,
        );
        if (ownedCandidateIds.length === 0) {
            return [];
        }

        const referencedSet =
            await collectReferencedDirectusFileIdsInternal(ownedCandidateIds);
        const orphanFileIds = ownedCandidateIds.filter(
            (id) => !referencedSet.has(id),
        );

        for (const fileId of orphanFileIds) {
            await deleteDirectusFile(fileId);
        }
        return orphanFileIds;
    });
}

export async function collectDiaryFileIds(diaryId: string): Promise<string[]> {
    return await runWithDirectusServiceAccess(async () => {
        const imageRows = await readMany("app_diary_images", {
            filter: { diary_id: { _eq: diaryId } } as JsonObject,
            fields: ["file_id"],
            limit: 5000,
        });
        const values = (imageRows as Array<Record<string, unknown>>).map(
            (row) => row.file_id,
        );
        return toUniqueFileIds(values);
    });
}

export async function collectAlbumFileIds(
    albumId: string,
    coverFile?: unknown,
): Promise<string[]> {
    return await runWithDirectusServiceAccess(async () => {
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
    });
}

export async function collectUserOwnedFileIds(
    userId: string,
): Promise<string[]> {
    return await runWithDirectusServiceAccess(async () => {
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
    });
}

async function collectCommentCleanupCandidatesByRelation(
    collection: "app_article_comments" | "app_diary_comments",
    relationField: "article_id" | "diary_id",
    relationId: string,
): Promise<DirectusFileCleanupCandidates> {
    return await runWithDirectusServiceAccess(async () => {
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
    });
}

export async function collectArticleCommentCleanupCandidates(
    articleId: string,
): Promise<DirectusFileCleanupCandidates> {
    return await collectCommentCleanupCandidatesByRelation(
        "app_article_comments",
        "article_id",
        articleId,
    );
}

export async function collectDiaryCommentCleanupCandidates(
    diaryId: string,
): Promise<DirectusFileCleanupCandidates> {
    return await collectCommentCleanupCandidatesByRelation(
        "app_diary_comments",
        "diary_id",
        diaryId,
    );
}
