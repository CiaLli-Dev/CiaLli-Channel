import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { collectReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import {
    deleteOrphanFileFromRepository,
    readStaleFileGcCandidatesFromRepository,
} from "@/server/repositories/files/file-cleanup.repository";
import { reconcileManagedFileLifecycle } from "@/server/files/file-lifecycle-reconciliation";
import { readManagedFilesByIds } from "@/server/repositories/files/file-lifecycle.repository";

const DEFAULT_FILE_GC_RETENTION_HOURS = 24;
const DEFAULT_FILE_GC_BATCH_SIZE = 200;
const DEFAULT_FILE_GC_INTERVAL_MS = 900_000;

type FileGcResult = {
    scanned: number;
    referenced: number;
    deleted: number;
    notFound: number;
    failed: number;
    skippedState: number;
    skippedReferenced: number;
    candidateFileIds: string[];
    deletedFileIds: string[];
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

let lifecycleReconciled = false;

async function ensureManagedFileLifecycleReconciled(now: Date): Promise<void> {
    if (lifecycleReconciled) {
        return;
    }
    const detachedBefore = buildDetachedBeforeIso(now);
    const result = await reconcileManagedFileLifecycle(detachedBefore);
    lifecycleReconciled = true;
    console.info("[file-gc-worker] lifecycle reconciled", result);
}

export async function runFileGcBatch(
    now: Date = new Date(),
): Promise<FileGcResult> {
    return await withServiceRepositoryContext(async () => {
        await ensureManagedFileLifecycleReconciled(now);
        const candidates = await readStaleFileGcCandidatesFromRepository({
            detachedBefore: buildDetachedBeforeIso(now),
            limit: readFileGcBatchSize(),
        });
        const candidateFileIds = candidates
            .map((candidate) => String(candidate.id || "").trim())
            .filter(Boolean);

        if (candidateFileIds.length === 0) {
            return {
                scanned: 0,
                referenced: 0,
                deleted: 0,
                notFound: 0,
                failed: 0,
                skippedState: 0,
                skippedReferenced: 0,
                candidateFileIds: [],
                deletedFileIds: [],
            };
        }

        const [referencedFileIds, currentLifecycleRows] = await Promise.all([
            collectReferencedDirectusFileIds(candidateFileIds),
            readManagedFilesByIds(candidateFileIds),
        ]);
        const detachedStateIds = new Set(
            currentLifecycleRows
                .filter((row) => row.app_lifecycle === "detached")
                .map((row) => row.id),
        );
        const activeCandidateFileIds = candidateFileIds.filter((fileId) =>
            detachedStateIds.has(fileId),
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
        let notFound = 0;
        let failed = 0;
        const deletedFileIds: string[] = [];
        for (const fileId of orphanFileIds) {
            const result = await deleteOrphanFileFromRepository(fileId);
            if (result.ok) {
                deleted += 1;
                deletedFileIds.push(fileId);
                continue;
            }
            if (result.reason === "not_found") {
                notFound += 1;
                continue;
            }
            failed += 1;
        }

        return {
            scanned: candidateFileIds.length,
            referenced: referencedFileIds.size,
            deleted,
            notFound,
            failed,
            skippedState:
                candidateFileIds.length - activeCandidateFileIds.length,
            skippedReferenced:
                activeCandidateFileIds.length - orphanFileIds.length,
            candidateFileIds,
            deletedFileIds,
        };
    });
}
