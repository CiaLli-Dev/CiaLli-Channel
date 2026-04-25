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

export {
    extractDirectusAssetIdsFromMarkdown,
    extractDirectusFileIdsFromUnknown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup-reference-utils";

async function collectReferencedDirectusFileIdsInternal(
    candidateFileIds: string[],
): Promise<Set<string>> {
    const normalizedCandidateIds = [...new Set(candidateFileIds)]
        .map((candidateFileId) => normalizeDirectusFileId(candidateFileId))
        .filter((candidateFileId): candidateFileId is string =>
            Boolean(candidateFileId),
        );
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

export async function collectAllReferencedDirectusFileIds(): Promise<
    Set<string>
> {
    return await withServiceRepositoryContext(async () => {
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
                        readAllReferencedIdsInMarkdownTargetFromRepository(
                            target,
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
