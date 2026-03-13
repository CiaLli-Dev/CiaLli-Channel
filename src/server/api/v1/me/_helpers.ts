import {
    renderMarkdown,
    type MarkdownRenderMode,
} from "@/server/markdown/render";
import { updateManagedFileMetadata } from "@/server/repositories/files/file-metadata.repository";

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
    userId: string,
    title?: string,
    visibility: "private" | "public" = "private",
): Promise<void> {
    const fileId = normalizeDirectusFileId(fileValue);
    if (!fileId) {
        return;
    }
    await updateManagedFileMetadata(fileId, {
        uploaded_by: userId,
        app_owner_user_id: userId,
        app_visibility: visibility,
        title: title?.trim() || undefined,
    } as never);
}

export async function syncMarkdownFilesToVisibility(
    markdown: string | null | undefined,
    userId: string,
    visibility: "private" | "public",
): Promise<string[]> {
    const fileIds = extractDirectusAssetIdsFromMarkdown(markdown);
    for (const fileId of fileIds) {
        await bindFileOwnerToUser(fileId, userId, undefined, visibility);
    }
    return fileIds;
}
