import { collectAllReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import {
    markFilesAttached,
    markFilesDetached,
    markFilesTemporary,
    readAllManagedFiles,
} from "@/server/repositories/files/file-lifecycle.repository";
import { readFileGcRetentionHours } from "@/server/files/file-gc";
import { seedFileReferencesWhenEmpty } from "@/server/files/file-reference-shadow";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";

const DEFAULT_FILE_LIFECYCLE_RECONCILE_INTERVAL_MS = 86_400_000;

function readPositiveIntegerEnv(
    value: string | undefined,
    fallback: number,
): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

export function readFileLifecycleReconcileIntervalMs(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_LIFECYCLE_RECONCILE_INTERVAL_MS ||
            import.meta.env.FILE_LIFECYCLE_RECONCILE_INTERVAL_MS,
        DEFAULT_FILE_LIFECYCLE_RECONCILE_INTERVAL_MS,
    );
}

type ClassifiedLifecycle =
    | "attached"
    | "detached"
    | "temporary"
    | "quarantined"
    | "deleted"
    | "protected";

function buildDetachedBeforeIso(now: Date): string {
    return new Date(
        now.getTime() - readFileGcRetentionHours() * 60 * 60 * 1000,
    ).toISOString();
}

function isExpired(detachedBefore: string, createdAt: string | null): boolean {
    if (!createdAt) {
        return true;
    }
    return createdAt <= detachedBefore;
}

function readFileCreatedAt(params: {
    date_created?: string | null;
    created_on?: string | null;
}): string | null {
    return params.date_created || params.created_on || null;
}

function classifyManagedFileLifecycle(params: {
    file: Awaited<ReturnType<typeof readAllManagedFiles>>[number];
    referencedFileIds: Set<string>;
    detachedBefore: string;
}): ClassifiedLifecycle {
    if (params.file.app_lifecycle === "protected") {
        return "protected";
    }
    if (
        params.file.app_lifecycle === "deleted" ||
        params.file.app_lifecycle === "deleting" ||
        params.file.app_lifecycle === "delete_failed"
    ) {
        return "deleted";
    }
    if (params.referencedFileIds.has(params.file.id)) {
        return "attached";
    }
    if (params.file.app_lifecycle === "quarantined") {
        return "quarantined";
    }
    if (isExpired(params.detachedBefore, readFileCreatedAt(params.file))) {
        return "detached";
    }
    return "temporary";
}

function collectClassifiedFile(params: {
    lifecycle: ClassifiedLifecycle;
    fileId: string;
    wasQuarantined: boolean;
    attachedFileIds: string[];
    quarantinedReferencedFileIds: string[];
    detachedFileIds: string[];
    temporaryFileIds: string[];
    counts: {
        quarantined: number;
        deleted: number;
        protected: number;
    };
}): void {
    if (params.lifecycle === "attached") {
        if (params.wasQuarantined) {
            params.quarantinedReferencedFileIds.push(params.fileId);
        } else {
            params.attachedFileIds.push(params.fileId);
        }
        return;
    }
    if (params.lifecycle === "detached") {
        params.detachedFileIds.push(params.fileId);
        return;
    }
    if (params.lifecycle === "temporary") {
        params.temporaryFileIds.push(params.fileId);
        return;
    }
    params.counts[params.lifecycle] += 1;
}

export async function reconcileManagedFileLifecycle(
    detachedBefore: string,
): Promise<{
    attached: number;
    detached: number;
    temporary: number;
    quarantined: number;
    deleted: number;
    protected: number;
}> {
    await seedFileReferencesWhenEmpty();
    const [referencedFileIds, files] = await Promise.all([
        collectAllReferencedDirectusFileIds(),
        readAllManagedFiles(),
    ]);

    const attachedFileIds: string[] = [];
    const quarantinedReferencedFileIds: string[] = [];
    const detachedFileIds: string[] = [];
    const temporaryFileIds: string[] = [];
    const counts = {
        quarantined: 0,
        deleted: 0,
        protected: 0,
    };

    for (const file of files) {
        if (!file.id) {
            continue;
        }
        const lifecycle = classifyManagedFileLifecycle({
            file,
            referencedFileIds,
            detachedBefore,
        });
        collectClassifiedFile({
            lifecycle,
            fileId: file.id,
            wasQuarantined: file.app_lifecycle === "quarantined",
            attachedFileIds,
            quarantinedReferencedFileIds,
            detachedFileIds,
            temporaryFileIds,
            counts,
        });
    }

    const [, restored] = await Promise.all([
        markFilesAttached({
            fileIds: attachedFileIds,
            allowLifecycleOverride: true,
        }),
        resourceLifecycle.restoreQuarantinedFiles({
            fileIds: quarantinedReferencedFileIds,
            requireReference: true,
        }),
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
                file.date_updated ||
                    file.modified_on ||
                    readFileCreatedAt(file) ||
                    detachedBefore,
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
        attached: attachedFileIds.length + restored.restoredFileIds.length,
        detached: detachedFileIds.length,
        temporary: temporaryFileIds.length,
        quarantined: counts.quarantined,
        deleted: counts.deleted,
        protected: counts.protected,
    };
}

export async function runManagedFileLifecycleReconciliation(
    now: Date = new Date(),
): ReturnType<typeof reconcileManagedFileLifecycle> {
    return await reconcileManagedFileLifecycle(buildDetachedBeforeIso(now));
}
