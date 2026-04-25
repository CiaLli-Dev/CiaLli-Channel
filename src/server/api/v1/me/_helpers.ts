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
    deleteOwnerReferences,
    replaceOwnerFieldReferences,
    type FileReferenceKind,
    type FileReferenceVisibility,
} from "@/server/repositories/files/file-reference.repository";

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
    await markFilesAttached({
        fileIds: [fileId],
        ownerUserId: userId ? userId : undefined,
        visibility,
        title,
    });
    if (reference) {
        await syncFileReferencesBestEffort({
            reference,
            fileIds: [fileId],
            ownerUserId: userId,
            visibility,
        });
    }
}

export type FileReferenceContext = {
    ownerCollection: string;
    ownerId: string;
    ownerField: string;
    referenceKind: FileReferenceKind;
};

async function syncFileReferencesBestEffort(params: {
    reference: FileReferenceContext;
    fileIds: string[];
    ownerUserId: string | null | undefined;
    visibility: FileReferenceVisibility;
}): Promise<void> {
    try {
        await replaceOwnerFieldReferences({
            ...params.reference,
            fileIds: params.fileIds,
            ownerUserId: params.ownerUserId,
            visibility: params.visibility,
        });
    } catch (error) {
        console.warn("[file-references] sync failed", {
            ownerCollection: params.reference.ownerCollection,
            ownerId: params.reference.ownerId,
            ownerField: params.reference.ownerField,
            referenceKind: params.reference.referenceKind,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function deleteFileReferencesForOwner(params: {
    ownerCollection: string;
    ownerId: string;
    ownerField?: string;
    referenceKind?: FileReferenceKind;
}): Promise<number> {
    try {
        return await deleteOwnerReferences(params);
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
    await markFilesAttached({
        fileIds,
        ownerUserId: userId,
        visibility,
    });
    if (reference) {
        await syncFileReferencesBestEffort({
            reference,
            fileIds,
            ownerUserId: userId,
            visibility,
        });
    }
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
    if (params.reference) {
        await syncFileReferencesBestEffort({
            reference: params.reference,
            fileIds: diff.nextFileIds,
            ownerUserId: params.userId,
            visibility: params.visibility,
        });
    }
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
    await markFilesAttached({
        fileIds: diff.nextFileIds,
        ownerUserId: params.userId ? params.userId : undefined,
        visibility: params.visibility,
    });
    await markFilesDetached(
        diff.detachedFileIds,
        params.detachedAt || new Date().toISOString(),
    );
    if (params.reference) {
        await syncFileReferencesBestEffort({
            reference: params.reference,
            fileIds: diff.nextFileIds,
            ownerUserId: params.userId,
            visibility: params.visibility,
        });
    }
    return diff;
}
