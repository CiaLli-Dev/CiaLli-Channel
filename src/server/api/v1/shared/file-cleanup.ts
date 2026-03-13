import type { JsonObject } from "@/types/json";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { toUniqueFileIds } from "@/server/api/v1/shared/file-cleanup-reference-utils";
import {
    readFileIdsFromCollectionFieldFromRepository,
    readOwnedDirectusFileIdsFromRepository,
    readDirectusUserAvatarFileIdsFromRepository,
    readRelationFileIdsFromRepository,
    readOwnerIdsFromRepository,
    readReferencedIdsInSiteSettingsFromRepository,
    readReferencedIdsInStructuredTargetFromRepository,
    readReferencedIdsInMarkdownTargetFromRepository,
    readDeletableOwnedFilesFromRepository,
    readCommentCleanupCandidatesFromRepository,
    readDiaryImageFileIdsFromRepository,
    readAlbumPhotoFileIdsFromRepository,
    deleteOrphanFileFromRepository,
    STRUCTURED_REFERENCE_TARGETS,
    MARKDOWN_REFERENCE_TARGETS,
} from "@/server/repositories/files/file-cleanup.repository";

export {
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup-reference-utils";

export type DirectusFileCleanupRequest = {
    candidateFileIds: string[];
    ownerUserIds?: string[];
};

export type DirectusFileCleanupCandidates = {
    candidateFileIds: string[];
    ownerUserIds: string[];
};

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

async function collectReferencedDirectusFileIdsInternal(
    candidateFileIds: string[],
): Promise<Set<string>> {
    const normalizedCandidateIds = toUniqueFileIds(candidateFileIds);
    const referencedSet = await readReferencedIdsInSiteSettingsFromRepository(
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
                readReferencedIdsInStructuredTargetFromRepository(
                    target,
                    unresolved,
                ),
            ),
        ),
        Promise.all(
            MARKDOWN_REFERENCE_TARGETS.map((target) =>
                readReferencedIdsInMarkdownTargetFromRepository(
                    target,
                    unresolved,
                ),
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
    return await withServiceRepositoryContext(async () =>
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

    return await withServiceRepositoryContext(async () => {
        const allowedOwnerIds = new Set(
            normalizeOwnerIds(request.ownerUserIds ?? []),
        );
        // 文件清理需要访问 directus_files 并执行物理删除，统一提升到 service 作用域。
        const ownedCandidateIds = await readDeletableOwnedFilesFromRepository(
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
            await deleteOrphanFileFromRepository(fileId);
        }
        return orphanFileIds;
    });
}

export async function collectDiaryFileIds(diaryId: string): Promise<string[]> {
    return await withServiceRepositoryContext(async () => {
        return await readDiaryImageFileIdsFromRepository(diaryId);
    });
}

export async function collectAlbumFileIds(
    albumId: string,
    coverFile?: unknown,
): Promise<string[]> {
    return await withServiceRepositoryContext(async () => {
        const values = await readAlbumPhotoFileIdsFromRepository(albumId);
        if (coverFile !== undefined) {
            return toUniqueFileIds([...values, coverFile]);
        }
        return values;
    });
}

export async function collectUserOwnedFileIds(
    userId: string,
): Promise<string[]> {
    return await withServiceRepositoryContext(async () => {
        const [
            profileHeaderFiles,
            directusAvatarFiles,
            articleCoverFiles,
            albumCoverFiles,
        ] = await Promise.all([
            readFileIdsFromCollectionFieldFromRepository(
                "app_user_profiles",
                "header_file",
                {
                    user_id: { _eq: userId },
                } as JsonObject,
            ),
            readDirectusUserAvatarFileIdsFromRepository(userId),
            readFileIdsFromCollectionFieldFromRepository(
                "app_articles",
                "cover_file",
                {
                    author_id: { _eq: userId },
                } as JsonObject,
            ),
            readFileIdsFromCollectionFieldFromRepository(
                "app_albums",
                "cover_file",
                {
                    author_id: { _eq: userId },
                } as JsonObject,
            ),
        ]);
        const [registrationAvatarFiles, uploadedByFiles] = await Promise.all([
            readFileIdsFromCollectionFieldFromRepository(
                "app_user_registration_requests",
                "avatar_file",
                {
                    approved_user_id: { _eq: userId },
                } as JsonObject,
            ),
            readOwnedDirectusFileIdsFromRepository(userId),
        ]);

        const [albumIds, diaryIds] = await Promise.all([
            readOwnerIdsFromRepository("app_albums", "author_id", userId),
            readOwnerIdsFromRepository("app_diaries", "author_id", userId),
        ]);

        const [albumPhotoFiles, diaryImageFiles] = await Promise.all([
            readRelationFileIdsFromRepository(
                "app_album_photos",
                "album_id",
                albumIds,
            ),
            readRelationFileIdsFromRepository(
                "app_diary_images",
                "diary_id",
                diaryIds,
            ),
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

export async function collectArticleCommentCleanupCandidates(
    articleId: string,
): Promise<DirectusFileCleanupCandidates> {
    return await withServiceRepositoryContext(async () => {
        return await readCommentCleanupCandidatesFromRepository(
            "app_article_comments",
            "article_id",
            articleId,
        );
    });
}

export async function collectDiaryCommentCleanupCandidates(
    diaryId: string,
): Promise<DirectusFileCleanupCandidates> {
    return await withServiceRepositoryContext(async () => {
        return await readCommentCleanupCandidatesFromRepository(
            "app_diary_comments",
            "diary_id",
            diaryId,
        );
    });
}
