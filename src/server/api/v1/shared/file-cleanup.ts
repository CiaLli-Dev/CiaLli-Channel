import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup-reference-utils";
import {
    readAllReferencedIdsInMarkdownTargetFromRepository,
    readAllReferencedIdsInSiteSettingsFromRepository,
    readAllReferencedIdsInStructuredTargetFromRepository,
    readAlbumPhotoFileIdsFromRepository,
    readCommentCleanupCandidatesFromRepository,
    readDiaryImageFileIdsFromRepository,
    readReferencedIdsInSiteSettingsFromRepository,
    readReferencedIdsInStructuredTargetFromRepository,
    readReferencedIdsInMarkdownTargetFromRepository,
    STRUCTURED_REFERENCE_TARGETS,
    MARKDOWN_REFERENCE_TARGETS,
} from "@/server/repositories/files/file-cleanup.repository";
import {
    readAllReferencedFileIdsFromReferenceTable,
    readReferencedFileIdsFromReferenceTable,
} from "@/server/repositories/files/file-reference.repository";

export {
    extractDirectusAssetIdsFromMarkdown,
    extractDirectusFileIdsFromUnknown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup-reference-utils";

async function collectReferenceTableDirectusFileIds(
    candidateFileIds: string[],
): Promise<Set<string>> {
    const normalizedCandidateIds = [...new Set(candidateFileIds)]
        .map((candidateFileId) => normalizeDirectusFileId(candidateFileId))
        .filter((candidateFileId): candidateFileId is string =>
            Boolean(candidateFileId),
        );
    return await readReferencedFileIdsFromReferenceTable(
        normalizedCandidateIds,
    );
}

export async function collectLegacyScannedReferencedDirectusFileIds(): Promise<
    Set<string>
> {
    const [siteSettingsMatches, structuredMatches, markdownMatches] =
        await Promise.all([
            readAllReferencedIdsInSiteSettingsFromRepository(),
            Promise.all(
                STRUCTURED_REFERENCE_TARGETS.map((target) =>
                    readAllReferencedIdsInStructuredTargetFromRepository(
                        target,
                    ),
                ),
            ),
            Promise.all(
                MARKDOWN_REFERENCE_TARGETS.map((target) =>
                    readAllReferencedIdsInMarkdownTargetFromRepository(target),
                ),
            ),
        ]);

    const referenced = new Set<string>(siteSettingsMatches);
    for (const result of [...structuredMatches, ...markdownMatches]) {
        for (const fileId of result) {
            referenced.add(fileId);
        }
    }
    return referenced;
}

export async function collectLegacyScannedReferencedDirectusFileIdsForCandidates(
    candidateFileIds: string[],
): Promise<Set<string>> {
    const normalizedCandidateIds = [...new Set(candidateFileIds)]
        .map((candidateFileId) => normalizeDirectusFileId(candidateFileId))
        .filter((candidateFileId): candidateFileId is string =>
            Boolean(candidateFileId),
        );
    if (normalizedCandidateIds.length === 0) {
        return new Set();
    }

    const [siteSettingsMatches, structuredMatches, markdownMatches] =
        await Promise.all([
            readReferencedIdsInSiteSettingsFromRepository(
                normalizedCandidateIds,
            ),
            Promise.all(
                STRUCTURED_REFERENCE_TARGETS.map((target) =>
                    readReferencedIdsInStructuredTargetFromRepository(
                        target,
                        normalizedCandidateIds,
                    ),
                ),
            ),
            Promise.all(
                MARKDOWN_REFERENCE_TARGETS.map((target) =>
                    readReferencedIdsInMarkdownTargetFromRepository(
                        target,
                        normalizedCandidateIds,
                    ),
                ),
            ),
        ]);

    const referenced = new Set<string>(siteSettingsMatches);
    for (const result of [...structuredMatches, ...markdownMatches]) {
        for (const fileId of result) {
            referenced.add(fileId);
        }
    }
    return referenced;
}

export async function collectReferencedDirectusFileIds(
    candidateFileIds: string[],
): Promise<Set<string>> {
    return await withServiceRepositoryContext(async () => {
        const [referenceTableIds, legacyScannedIds] = await Promise.all([
            collectReferenceTableDirectusFileIds(candidateFileIds),
            collectLegacyScannedReferencedDirectusFileIdsForCandidates(
                candidateFileIds,
            ),
        ]);
        return new Set([...referenceTableIds, ...legacyScannedIds]);
    });
}

export async function collectAllReferencedDirectusFileIds(): Promise<
    Set<string>
> {
    return await withServiceRepositoryContext(async () => {
        const [referenceTableIds, legacyScannedIds] = await Promise.all([
            readAllReferencedFileIdsFromReferenceTable(),
            collectLegacyScannedReferencedDirectusFileIds(),
        ]);
        return new Set([...referenceTableIds, ...legacyScannedIds]);
    });
}

export async function collectArticleCommentCleanupCandidates(
    articleId: string,
): Promise<{ candidateFileIds: string[]; ownerUserIds: string[] }> {
    return await withServiceRepositoryContext(async () =>
        readCommentCleanupCandidatesFromRepository(
            "app_article_comments",
            "article_id",
            articleId,
        ),
    );
}

export async function collectDiaryCommentCleanupCandidates(
    diaryId: string,
): Promise<{ candidateFileIds: string[]; ownerUserIds: string[] }> {
    return await withServiceRepositoryContext(async () =>
        readCommentCleanupCandidatesFromRepository(
            "app_diary_comments",
            "diary_id",
            diaryId,
        ),
    );
}

export async function collectDiaryFileIds(diaryId: string): Promise<string[]> {
    return await withServiceRepositoryContext(async () =>
        readDiaryImageFileIdsFromRepository(diaryId),
    );
}

export async function collectAlbumFileIds(albumId: string): Promise<string[]> {
    return await withServiceRepositoryContext(async () =>
        readAlbumPhotoFileIdsFromRepository(albumId),
    );
}
