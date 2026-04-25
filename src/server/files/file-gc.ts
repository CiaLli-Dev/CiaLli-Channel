import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { collectReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import {
    deleteOrphanFileFromRepository,
    readStaleFileGcCandidatesFromRepository,
} from "@/server/repositories/files/file-cleanup.repository";
import { readManagedFilesByIds } from "@/server/repositories/files/file-lifecycle.repository";

const DEFAULT_FILE_GC_RETENTION_HOURS = 168;
const DEFAULT_FILE_GC_BATCH_SIZE = 200;
const DEFAULT_FILE_GC_INTERVAL_MS = 900_000;

type FileGcResult = {
    dryRun: boolean;
    scanned: number;
    referenced: number;
    deleted: number;
    wouldDelete: number;
    notFound: number;
    failed: number;
    skippedState: number;
    skippedReferenced: number;
    candidateFileIds: string[];
    deletedFileIds: string[];
    wouldDeleteFileIds: string[];
};

type FileGcOptions = {
    dryRun?: boolean;
};

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

export function readFileGcRetentionHours(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_GC_RETENTION_HOURS ||
            import.meta.env.FILE_GC_RETENTION_HOURS,
        DEFAULT_FILE_GC_RETENTION_HOURS,
    );
}

export function readFileGcBatchSize(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_GC_BATCH_SIZE || import.meta.env.FILE_GC_BATCH_SIZE,
        DEFAULT_FILE_GC_BATCH_SIZE,
    );
}

export function readFileGcIntervalMs(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_GC_INTERVAL_MS || import.meta.env.FILE_GC_INTERVAL_MS,
        DEFAULT_FILE_GC_INTERVAL_MS,
    );
}

function buildDetachedBeforeIso(now: Date): string {
    return new Date(
        now.getTime() - readFileGcRetentionHours() * 60 * 60 * 1000,
    ).toISOString();
}

type ManagedFileGcState = {
    id?: string | null;
    date_created?: string | null;
    app_lifecycle?: "temporary" | "attached" | "detached" | "protected" | null;
    app_detached_at?: string | null;
};

function isGcEligibleLifecycle(
    row: ManagedFileGcState | undefined,
    detachedBefore: string,
): boolean {
    if (!row) {
        return false;
    }
    if (row.app_lifecycle === "detached") {
        return Boolean(
            row.app_detached_at && row.app_detached_at <= detachedBefore,
        );
    }
    if (row.app_lifecycle === "temporary") {
        return Boolean(row.date_created && row.date_created <= detachedBefore);
    }
    return false;
}

function readAuditLifecycle(row: ManagedFileGcState | undefined): string {
    return row?.app_lifecycle || "unknown";
}

function logFileGcAudit(params: {
    fileId: string;
    dryRun: boolean;
    detachedBefore: string;
    lifecycle: string;
    outcome: "deleted" | "would_delete" | "not_found" | "failed";
    reason?: string;
    message?: string;
}): void {
    const payload = {
        event: "file_gc_delete",
        fileId: params.fileId,
        dryRun: params.dryRun,
        detachedBefore: params.detachedBefore,
        lifecycle: params.lifecycle,
        outcome: params.outcome,
        ...(params.reason ? { reason: params.reason } : {}),
        ...(params.message ? { message: params.message } : {}),
    };

    if (params.outcome === "failed") {
        console.error("[file-gc] delete audit", payload);
        return;
    }
    if (params.outcome === "not_found") {
        console.warn("[file-gc] delete audit", payload);
        return;
    }
    console.info("[file-gc] delete audit", payload);
}

export async function runFileGcBatch(
    now: Date = new Date(),
    options: FileGcOptions = {},
): Promise<FileGcResult> {
    return await withServiceRepositoryContext(async () => {
        const dryRun = options.dryRun === true;
        const detachedBefore = buildDetachedBeforeIso(now);
        const candidates = await readStaleFileGcCandidatesFromRepository({
            detachedBefore,
            limit: readFileGcBatchSize(),
        });
        const candidateFileIds = candidates
            .map((candidate) => String(candidate.id || "").trim())
            .filter(Boolean);

        if (candidateFileIds.length === 0) {
            return {
                dryRun,
                scanned: 0,
                referenced: 0,
                deleted: 0,
                wouldDelete: 0,
                notFound: 0,
                failed: 0,
                skippedState: 0,
                skippedReferenced: 0,
                candidateFileIds: [],
                deletedFileIds: [],
                wouldDeleteFileIds: [],
            };
        }

        const [referencedFileIds, currentLifecycleRows] = await Promise.all([
            collectReferencedDirectusFileIds(candidateFileIds),
            readManagedFilesByIds(candidateFileIds),
        ]);
        const currentLifecycleById = new Map(
            currentLifecycleRows.map((row) => [row.id, row]),
        );
        const activeCandidateFileIds = candidateFileIds.filter((fileId) =>
            isGcEligibleLifecycle(
                currentLifecycleById.get(fileId),
                detachedBefore,
            ),
        );
        const referencedActiveFileIds = new Set(
            activeCandidateFileIds.filter((fileId) =>
                referencedFileIds.has(fileId),
            ),
        );
        const orphanFileIds = activeCandidateFileIds.filter(
            (fileId) => !referencedActiveFileIds.has(fileId),
        );

        let deleted = 0;
        let wouldDelete = 0;
        let notFound = 0;
        let failed = 0;
        let finalSkippedState = 0;
        let finalSkippedReferenced = 0;
        const deletedFileIds: string[] = [];
        const wouldDeleteFileIds: string[] = [];
        for (const fileId of orphanFileIds) {
            const finalReferencedFileIds =
                await collectReferencedDirectusFileIds([fileId]);
            if (finalReferencedFileIds.has(fileId)) {
                finalSkippedReferenced += 1;
                continue;
            }
            const [finalLifecycleRow] = await readManagedFilesByIds([fileId]);
            if (!isGcEligibleLifecycle(finalLifecycleRow, detachedBefore)) {
                finalSkippedState += 1;
                continue;
            }
            const lifecycle = readAuditLifecycle(finalLifecycleRow);
            if (dryRun) {
                wouldDelete += 1;
                wouldDeleteFileIds.push(fileId);
                logFileGcAudit({
                    fileId,
                    dryRun,
                    detachedBefore,
                    lifecycle,
                    outcome: "would_delete",
                });
                continue;
            }
            const result = await deleteOrphanFileFromRepository(fileId);
            if (result.ok) {
                deleted += 1;
                deletedFileIds.push(fileId);
                logFileGcAudit({
                    fileId,
                    dryRun,
                    detachedBefore,
                    lifecycle,
                    outcome: "deleted",
                });
                continue;
            }
            if (result.reason === "not_found") {
                notFound += 1;
                logFileGcAudit({
                    fileId,
                    dryRun,
                    detachedBefore,
                    lifecycle,
                    outcome: "not_found",
                    reason: result.reason,
                });
                continue;
            }
            failed += 1;
            logFileGcAudit({
                fileId,
                dryRun,
                detachedBefore,
                lifecycle,
                outcome: "failed",
                reason: result.reason,
            });
        }

        const skippedState =
            candidateFileIds.length -
            activeCandidateFileIds.length +
            finalSkippedState;
        const skippedReferenced =
            activeCandidateFileIds.length -
            orphanFileIds.length +
            finalSkippedReferenced;

        return {
            dryRun,
            scanned: candidateFileIds.length,
            referenced: referencedFileIds.size,
            deleted,
            wouldDelete,
            notFound,
            failed,
            skippedState: skippedState,
            skippedReferenced,
            candidateFileIds,
            deletedFileIds,
            wouldDeleteFileIds,
        };
    });
}
