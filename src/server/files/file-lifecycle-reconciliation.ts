import { collectAllReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import {
    markFilesAttached,
    markFilesDetached,
    markFilesTemporary,
    readAllManagedFiles,
} from "@/server/repositories/files/file-lifecycle.repository";

function isExpired(detachedBefore: string, createdAt: string | null): boolean {
    if (!createdAt) {
        return true;
    }
    return createdAt <= detachedBefore;
}

function classifyManagedFileLifecycle(params: {
    file: Awaited<ReturnType<typeof readAllManagedFiles>>[number];
    referencedFileIds: Set<string>;
    detachedBefore: string;
}): "attached" | "detached" | "temporary" | "protected" {
    if (params.file.app_lifecycle === "protected") {
        return "protected";
    }
    if (params.referencedFileIds.has(params.file.id)) {
        return "attached";
    }
    if (isExpired(params.detachedBefore, params.file.date_created ?? null)) {
        return "detached";
    }
    return "temporary";
}

export async function reconcileManagedFileLifecycle(
    detachedBefore: string,
): Promise<{
    attached: number;
    detached: number;
    temporary: number;
    protected: number;
}> {
    const [referencedFileIds, files] = await Promise.all([
        collectAllReferencedDirectusFileIds(),
        readAllManagedFiles(),
    ]);

    const attachedFileIds: string[] = [];
    const detachedFileIds: string[] = [];
    const temporaryFileIds: string[] = [];
    let protectedCount = 0;

    for (const file of files) {
        if (!file.id) {
            continue;
        }
        const lifecycle = classifyManagedFileLifecycle({
            file,
            referencedFileIds,
            detachedBefore,
        });
        if (lifecycle === "protected") {
            protectedCount += 1;
            continue;
        }
        if (lifecycle === "attached") {
            attachedFileIds.push(file.id);
            continue;
        }
        if (lifecycle === "detached") {
            detachedFileIds.push(file.id);
            continue;
        }
        temporaryFileIds.push(file.id);
    }

    await Promise.all([
        markFilesAttached({ fileIds: attachedFileIds }),
        markFilesTemporary(temporaryFileIds),
    ]);

    if (detachedFileIds.length > 0) {
        const detachedAtById = new Map<string, string>();
        for (const file of files) {
            if (!detachedFileIds.includes(file.id)) {
                continue;
            }
            detachedAtById.set(
                file.id,
                file.date_updated || file.date_created || detachedBefore,
            );
        }

        const fileIdsByDetachedAt = new Map<string, string[]>();
        for (const fileId of detachedFileIds) {
            const detachedAt = detachedAtById.get(fileId) || detachedBefore;
            const existing = fileIdsByDetachedAt.get(detachedAt) || [];
            existing.push(fileId);
            fileIdsByDetachedAt.set(detachedAt, existing);
        }

        for (const [detachedAt, fileIds] of fileIdsByDetachedAt) {
            await markFilesDetached(fileIds, detachedAt);
        }
    }

    return {
        attached: attachedFileIds.length,
        detached: detachedFileIds.length,
        temporary: temporaryFileIds.length,
        protected: protectedCount,
    };
}
