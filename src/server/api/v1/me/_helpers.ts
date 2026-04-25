import {
    renderMarkdown,
    type MarkdownRenderMode,
} from "@/server/markdown/render";
import {
    diffFileIds,
    diffMarkdownFileIds,
    markFilesAttached,
    markFilesDetached,
} from "@/server/repositories/files/file-lifecycle.repository";
import {
    type FileReferenceKind,
    type FileReferenceVisibility,
} from "@/server/repositories/files/file-reference.repository";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";

import {
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";

export function isSlugUniqueConflict(error: unknown): boolean {
    const message = String(error).toLowerCase();
    return (
        message.includes('field "slug"') ||
        message.includes(" field slug ") ||
        message.includes(".slug")
    );
}

export async function renderMeMarkdownPreview(
    markdown: string,
    mode: MarkdownRenderMode = "full",
): Promise<string> {
    const source = String(markdown || "");
    if (!source.trim()) {
        return "";
    }
    try {
        return await renderMarkdown(source, {
            target: "page",
            mode,
            // 仅预览链路放开 blob，支持本地粘贴图在编辑阶段即时预览。
            allowBlobImages: true,
        });
    } catch (error) {
        console.error("[me] markdown preview failed:", error);
        return "";
    }
}

export async function bindFileOwnerToUser(
    fileValue: unknown,
    userId: string | null | undefined,
    title?: string,
    visibility: "private" | "public" = "private",
    reference?: FileReferenceContext,
): Promise<void> {
    const fileId = normalizeDirectusFileId(fileValue);
    if (!fileId) {
        return;
    }
    if (reference) {
        await resourceLifecycle.syncOwnerReferences({
            ownerCollection: reference.ownerCollection,
            ownerId: reference.ownerId,
            ownerUserId: userId ?? null,
            visibility,
            references: [
                {
                    ownerField: reference.ownerField,
                    referenceKind: reference.referenceKind,
                    fileIds: [fileId],
                },
            ],
        });
        if (title) {
            await markFilesAttached({
                fileIds: [fileId],
                ownerUserId: userId ? userId : undefined,
                visibility,
                title,
            });
        }
        return;
    }
    await markFilesAttached({
        fileIds: [fileId],
        ownerUserId: userId ? userId : undefined,
        visibility,
        title,
    });
}

export type FileReferenceContext = {
    ownerCollection: string;
    ownerId: string;
    ownerField: string;
    referenceKind: FileReferenceKind;
};

export async function deleteFileReferencesForOwner(params: {
    ownerCollection: string;
    ownerId: string;
    ownerField?: string;
    referenceKind?: FileReferenceKind;
}): Promise<number> {
    try {
        if (params.ownerField || params.referenceKind) {
            console.warn(
                "[file-references] field-scoped delete is deprecated; releasing owner",
                params,
            );
        }
        const result = await resourceLifecycle.releaseOwnerResources({
            ownerCollection: params.ownerCollection,
            ownerId: params.ownerId,
        });
        return result.deletedReferences;
    } catch (error) {
        console.warn("[file-references] delete failed", {
            ...params,
            error: error instanceof Error ? error.message : String(error),
        });
        return 0;
    }
}

export async function syncMarkdownFilesToVisibility(
    markdown: string | null | undefined,
    userId: string,
    visibility: FileReferenceVisibility,
    reference?: FileReferenceContext,
): Promise<string[]> {
    const fileIds = extractDirectusAssetIdsFromMarkdown(markdown);
    if (reference) {
        await resourceLifecycle.syncOwnerReferences({
            ownerCollection: reference.ownerCollection,
            ownerId: reference.ownerId,
            ownerUserId: userId,
            visibility,
            references: [
                {
                    ownerField: reference.ownerField,
                    referenceKind: reference.referenceKind,
                    fileIds,
                },
            ],
        });
        return fileIds;
    }
    await markFilesAttached({
        fileIds,
        ownerUserId: userId,
        visibility,
    });
    return fileIds;
}

export async function detachManagedFiles(
    fileValues: unknown[],
    detachedAt: string = new Date().toISOString(),
): Promise<string[]> {
    const { detachedFileIds } = diffFileIds({
        previousFileIds: fileValues,
        nextFileIds: [],
    });
    await markFilesDetached(detachedFileIds, detachedAt);
    return detachedFileIds;
}

export async function detachMarkdownFiles(
    markdownValues: Array<string | null | undefined>,
    detachedAt: string = new Date().toISOString(),
): Promise<string[]> {
    return await detachManagedFiles(
        markdownValues.flatMap((markdown) =>
            extractDirectusAssetIdsFromMarkdown(markdown),
        ),
        detachedAt,
    );
}

export async function syncManagedFileBinding(params: {
    previousFileValue: unknown;
    nextFileValue: unknown;
    userId: string | null | undefined;
    title?: string;
    visibility: FileReferenceVisibility;
    detachedAt?: string;
    reference?: FileReferenceContext;
}): Promise<{
    attachedFileIds: string[];
    detachedFileIds: string[];
    nextFileIds: string[];
}> {
    const diff = diffFileIds({
        previousFileIds: [params.previousFileValue],
        nextFileIds: [params.nextFileValue],
    });
    if (params.reference) {
        await resourceLifecycle.syncOwnerReferences({
            ownerCollection: params.reference.ownerCollection,
            ownerId: params.reference.ownerId,
            ownerUserId: params.userId ?? null,
            visibility: params.visibility,
            references: [
                {
                    ownerField: params.reference.ownerField,
                    referenceKind: params.reference.referenceKind,
                    fileIds: diff.nextFileIds,
                },
            ],
        });
        if (params.title) {
            await markFilesAttached({
                fileIds: diff.nextFileIds,
                ownerUserId: params.userId ? params.userId : undefined,
                visibility: params.visibility,
                title: params.title,
            });
        }
        return diff;
    }
    await markFilesAttached({
        fileIds: diff.nextFileIds,
        ownerUserId: params.userId ? params.userId : undefined,
        visibility: params.visibility,
        title: params.title,
    });
    await markFilesDetached(
        diff.detachedFileIds,
        params.detachedAt || new Date().toISOString(),
    );
    return diff;
}

export async function syncMarkdownFileLifecycle(params: {
    previousMarkdown: string | null | undefined;
    nextMarkdown: string | null | undefined;
    userId: string | null | undefined;
    visibility: FileReferenceVisibility;
    detachedAt?: string;
    reference?: FileReferenceContext;
}): Promise<{
    attachedFileIds: string[];
    detachedFileIds: string[];
    nextFileIds: string[];
}> {
    const diff = diffMarkdownFileIds({
        previousMarkdown: params.previousMarkdown,
        nextMarkdown: params.nextMarkdown,
    });
    if (params.reference) {
        await resourceLifecycle.syncOwnerReferences({
            ownerCollection: params.reference.ownerCollection,
            ownerId: params.reference.ownerId,
            ownerUserId: params.userId ?? null,
            visibility: params.visibility,
            references: [
                {
                    ownerField: params.reference.ownerField,
                    referenceKind: params.reference.referenceKind,
                    fileIds: diff.nextFileIds,
                },
            ],
        });
        return diff;
    }
    await markFilesAttached({
        fileIds: diff.nextFileIds,
        ownerUserId: params.userId ? params.userId : undefined,
        visibility: params.visibility,
    });
    await markFilesDetached(
        diff.detachedFileIds,
        params.detachedAt || new Date().toISOString(),
    );
    return diff;
}
