import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { collectReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import {
    deleteOrphanFileFromRepository,
    readStaleFileGcCandidatesFromRepository,
} from "@/server/repositories/files/file-cleanup.repository";
import {
    markFilesAttached,
    markFilesDeleted,
    markFilesQuarantined,
    readManagedFilesByIds,
} from "@/server/repositories/files/file-lifecycle.repository";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";

const DEFAULT_FILE_GC_RETENTION_HOURS = 168;
const DEFAULT_FILE_GC_QUARANTINE_DAYS = 7;
const DEFAULT_FILE_GC_BATCH_SIZE = 200;
const DEFAULT_FILE_GC_INTERVAL_MS = 900_000;

type FileGcPhase = "quarantine" | "delete";

type FileGcResult = {
    dryRun: boolean;
    scanned: number;
    referenced: number;
    quarantined: number;
    wouldQuarantine: number;
    recovered: number;
    deleted: number;
    wouldDelete: number;
    notFound: number;
    failed: number;
    skippedState: number;
    skippedReferenced: number;
    candidateFileIds: string[];
    quarantinedFileIds: string[];
    wouldQuarantineFileIds: string[];
    recoveredFileIds: string[];
    deletedFileIds: string[];
    wouldDeleteFileIds: string[];
};

type FileGcOptions = {
    dryRun?: boolean;
};

type FileGcCutoffs = {
    detachedBefore: string;
    quarantinedBefore: string;
};

type FileGcMutableResult = {
    quarantined: number;
    wouldQuarantine: number;
    recovered: number;
    deleted: number;
    wouldDelete: number;
    notFound: number;
    failed: number;
    finalSkippedState: number;
    finalSkippedReferenced: number;
    quarantinedFileIds: string[];
    wouldQuarantineFileIds: string[];
    recoveredFileIds: string[];
    deletedFileIds: string[];
    wouldDeleteFileIds: string[];
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

export function readFileGcQuarantineDays(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_GC_QUARANTINE_DAYS ||
            import.meta.env.FILE_GC_QUARANTINE_DAYS,
        DEFAULT_FILE_GC_QUARANTINE_DAYS,
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

function buildQuarantinedBeforeIso(now: Date): string {
    return new Date(
        now.getTime() - readFileGcQuarantineDays() * 24 * 60 * 60 * 1000,
    ).toISOString();
}

type ManagedFileGcState = {
    id?: string | null;
    date_created?: string | null;
    app_lifecycle?:
        | "temporary"
        | "attached"
        | "detached"
        | "quarantined"
        | "deleted"
        | "protected"
        | null;
    app_detached_at?: string | null;
    app_quarantined_at?: string | null;
    app_deleted_at?: string | null;
};

function readGcPhase(
    row: ManagedFileGcState | undefined,
    cutoffs: { detachedBefore: string; quarantinedBefore: string },
): FileGcPhase | null {
    if (!row) {
        return null;
    }
    if (row.app_lifecycle === "detached") {
        return row.app_detached_at &&
            row.app_detached_at <= cutoffs.detachedBefore
            ? "quarantine"
            : null;
    }
    if (row.app_lifecycle === "quarantined") {
        return row.app_quarantined_at &&
            row.app_quarantined_at <= cutoffs.quarantinedBefore
            ? "delete"
            : null;
    }
    if (row.app_lifecycle === "deleted") {
        return "delete";
    }
    return null;
}

function readAuditLifecycle(row: ManagedFileGcState | undefined): string {
    return row?.app_lifecycle || "unknown";
}

function createEmptyFileGcResult(dryRun: boolean): FileGcResult {
    return {
        dryRun,
        scanned: 0,
        referenced: 0,
        quarantined: 0,
        wouldQuarantine: 0,
        recovered: 0,
        deleted: 0,
        wouldDelete: 0,
        notFound: 0,
        failed: 0,
        skippedState: 0,
        skippedReferenced: 0,
        candidateFileIds: [],
        quarantinedFileIds: [],
        wouldQuarantineFileIds: [],
        recoveredFileIds: [],
        deletedFileIds: [],
        wouldDeleteFileIds: [],
    };
}

function createMutableFileGcResult(): FileGcMutableResult {
    return {
        quarantined: 0,
        wouldQuarantine: 0,
        recovered: 0,
        deleted: 0,
        wouldDelete: 0,
        notFound: 0,
        failed: 0,
        finalSkippedState: 0,
        finalSkippedReferenced: 0,
        quarantinedFileIds: [],
        wouldQuarantineFileIds: [],
        recoveredFileIds: [],
        deletedFileIds: [],
        wouldDeleteFileIds: [],
    };
}

function logFileGcAudit(params: {
    fileId: string;
    dryRun: boolean;
    detachedBefore: string;
    quarantinedBefore: string;
    lifecycle: string;
    outcome:
        | "quarantined"
        | "would_quarantine"
        | "recovered"
        | "deleted"
        | "would_delete"
        | "not_found"
        | "failed";
    reason?: string;
    message?: string;
}): void {
    const payload = {
        event: "file_gc_delete",
        fileId: params.fileId,
        dryRun: params.dryRun,
        detachedBefore: params.detachedBefore,
        quarantinedBefore: params.quarantinedBefore,
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

async function recoverReferencedFileIds(params: {
    fileIds: string[];
    dryRun: boolean;
    cutoffs: FileGcCutoffs;
    currentLifecycleById: Map<string, ManagedFileGcState>;
    state: FileGcMutableResult;
}): Promise<void> {
    if (params.dryRun || params.fileIds.length === 0) {
        return;
    }

    const quarantinedFileIds = params.fileIds.filter(
        (fileId) =>
            params.currentLifecycleById.get(fileId)?.app_lifecycle ===
            "quarantined",
    );
    const attachedFileIds = params.fileIds.filter(
        (fileId) => !quarantinedFileIds.includes(fileId),
    );
    const restored = await resourceLifecycle.restoreQuarantinedFiles({
        fileIds: quarantinedFileIds,
        requireReference: true,
    });
    const recoveredFileIds = [...attachedFileIds, ...restored.restoredFileIds];
    if (attachedFileIds.length > 0) {
        await markFilesAttached({ fileIds: attachedFileIds });
    }
    params.state.recovered += recoveredFileIds.length;
    params.state.recoveredFileIds.push(...recoveredFileIds);

    for (const fileId of recoveredFileIds) {
        logFileGcAudit({
            fileId,
            dryRun: params.dryRun,
            detachedBefore: params.cutoffs.detachedBefore,
            quarantinedBefore: params.cutoffs.quarantinedBefore,
            lifecycle: readAuditLifecycle(
                params.currentLifecycleById.get(fileId),
            ),
            outcome: "recovered",
            reason: "referenced",
        });
    }
}

function recordDryRunAction(params: {
    fileId: string;
    phase: FileGcPhase;
    lifecycle: string;
    dryRun: boolean;
    cutoffs: FileGcCutoffs;
    state: FileGcMutableResult;
}): void {
    if (params.phase === "quarantine") {
        params.state.wouldQuarantine += 1;
        params.state.wouldQuarantineFileIds.push(params.fileId);
        logFileGcAudit({
            fileId: params.fileId,
            dryRun: params.dryRun,
            detachedBefore: params.cutoffs.detachedBefore,
            quarantinedBefore: params.cutoffs.quarantinedBefore,
            lifecycle: params.lifecycle,
            outcome: "would_quarantine",
        });
        return;
    }

    params.state.wouldDelete += 1;
    params.state.wouldDeleteFileIds.push(params.fileId);
    logFileGcAudit({
        fileId: params.fileId,
        dryRun: params.dryRun,
        detachedBefore: params.cutoffs.detachedBefore,
        quarantinedBefore: params.cutoffs.quarantinedBefore,
        lifecycle: params.lifecycle,
        outcome: "would_delete",
    });
}

async function quarantineFile(params: {
    fileId: string;
    now: Date;
    dryRun: boolean;
    cutoffs: FileGcCutoffs;
    lifecycle: string;
    state: FileGcMutableResult;
}): Promise<void> {
    await markFilesQuarantined([params.fileId], params.now.toISOString());
    params.state.quarantined += 1;
    params.state.quarantinedFileIds.push(params.fileId);
    logFileGcAudit({
        fileId: params.fileId,
        dryRun: params.dryRun,
        detachedBefore: params.cutoffs.detachedBefore,
        quarantinedBefore: params.cutoffs.quarantinedBefore,
        lifecycle: params.lifecycle,
        outcome: "quarantined",
    });
}

async function deleteFile(params: {
    fileId: string;
    now: Date;
    dryRun: boolean;
    cutoffs: FileGcCutoffs;
    lifecycle: string;
    row: ManagedFileGcState | undefined;
    state: FileGcMutableResult;
}): Promise<void> {
    if (params.row?.app_lifecycle !== "deleted") {
        await markFilesDeleted([params.fileId], params.now.toISOString());
    }

    const result = await deleteOrphanFileFromRepository(params.fileId);
    if (result.ok) {
        params.state.deleted += 1;
        params.state.deletedFileIds.push(params.fileId);
        logFileGcAudit({
            fileId: params.fileId,
            dryRun: params.dryRun,
            detachedBefore: params.cutoffs.detachedBefore,
            quarantinedBefore: params.cutoffs.quarantinedBefore,
            lifecycle: params.lifecycle,
            outcome: "deleted",
        });
        return;
    }

    if (result.reason === "not_found") {
        params.state.notFound += 1;
        logFileGcAudit({
            fileId: params.fileId,
            dryRun: params.dryRun,
            detachedBefore: params.cutoffs.detachedBefore,
            quarantinedBefore: params.cutoffs.quarantinedBefore,
            lifecycle: params.lifecycle,
            outcome: "not_found",
            reason: result.reason,
        });
        return;
    }

    params.state.failed += 1;
    logFileGcAudit({
        fileId: params.fileId,
        dryRun: params.dryRun,
        detachedBefore: params.cutoffs.detachedBefore,
        quarantinedBefore: params.cutoffs.quarantinedBefore,
        lifecycle: params.lifecycle,
        outcome: "failed",
        reason: result.reason,
    });
}

async function processOrphanFile(params: {
    fileId: string;
    now: Date;
    dryRun: boolean;
    cutoffs: FileGcCutoffs;
    currentLifecycleById: Map<string, ManagedFileGcState>;
    state: FileGcMutableResult;
}): Promise<void> {
    const finalReferencedFileIds = await collectReferencedDirectusFileIds([
        params.fileId,
    ]);
    if (finalReferencedFileIds.has(params.fileId)) {
        params.state.finalSkippedReferenced += 1;
        await recoverReferencedFileIds({
            fileIds: [params.fileId],
            dryRun: params.dryRun,
            cutoffs: params.cutoffs,
            currentLifecycleById: params.currentLifecycleById,
            state: params.state,
        });
        return;
    }

    const [finalLifecycleRow] = await readManagedFilesByIds([params.fileId]);
    const finalPhase = readGcPhase(finalLifecycleRow, params.cutoffs);
    if (!finalPhase) {
        params.state.finalSkippedState += 1;
        return;
    }

    const lifecycle = readAuditLifecycle(finalLifecycleRow);
    if (params.dryRun) {
        recordDryRunAction({
            fileId: params.fileId,
            phase: finalPhase,
            lifecycle,
            dryRun: params.dryRun,
            cutoffs: params.cutoffs,
            state: params.state,
        });
        return;
    }

    if (finalPhase === "quarantine") {
        await quarantineFile({
            fileId: params.fileId,
            now: params.now,
            dryRun: params.dryRun,
            cutoffs: params.cutoffs,
            lifecycle,
            state: params.state,
        });
        return;
    }

    await deleteFile({
        fileId: params.fileId,
        now: params.now,
        dryRun: params.dryRun,
        cutoffs: params.cutoffs,
        lifecycle,
        row: finalLifecycleRow,
        state: params.state,
    });
}

export async function runFileGcBatch(
    now: Date = new Date(),
    options: FileGcOptions = {},
): Promise<FileGcResult> {
    return await withServiceRepositoryContext(async () => {
        const dryRun = options.dryRun === true;
        const detachedBefore = buildDetachedBeforeIso(now);
        const quarantinedBefore = buildQuarantinedBeforeIso(now);
        const candidates = await readStaleFileGcCandidatesFromRepository({
            detachedBefore,
            quarantinedBefore,
            limit: readFileGcBatchSize(),
        });
        const candidateFileIds = candidates
            .map((candidate) => String(candidate.id || "").trim())
            .filter(Boolean);

        if (candidateFileIds.length === 0) {
            return createEmptyFileGcResult(dryRun);
        }

        const [referencedFileIds, currentLifecycleRows] = await Promise.all([
            collectReferencedDirectusFileIds(candidateFileIds),
            readManagedFilesByIds(candidateFileIds),
        ]);
        const currentLifecycleById = new Map(
            currentLifecycleRows.map((row) => [row.id, row]),
        );
        const cutoffs = { detachedBefore, quarantinedBefore };
        const activeCandidateFileIds = candidateFileIds.filter((fileId) =>
            Boolean(readGcPhase(currentLifecycleById.get(fileId), cutoffs)),
        );
        const referencedActiveFileIds = new Set(
            activeCandidateFileIds.filter((fileId) =>
                referencedFileIds.has(fileId),
            ),
        );
        const orphanFileIds = activeCandidateFileIds.filter(
            (fileId) => !referencedActiveFileIds.has(fileId),
        );

        const state = createMutableFileGcResult();
        await recoverReferencedFileIds({
            fileIds: [...referencedActiveFileIds],
            dryRun,
            cutoffs,
            currentLifecycleById,
            state,
        });

        for (const fileId of orphanFileIds) {
            await processOrphanFile({
                fileId,
                now,
                dryRun,
                cutoffs,
                currentLifecycleById,
                state,
            });
        }

        const skippedState =
            candidateFileIds.length -
            activeCandidateFileIds.length +
            state.finalSkippedState;
        const skippedReferenced =
            activeCandidateFileIds.length -
            orphanFileIds.length +
            state.finalSkippedReferenced;

        return {
            dryRun,
            scanned: candidateFileIds.length,
            referenced: referencedFileIds.size,
            quarantined: state.quarantined,
            wouldQuarantine: state.wouldQuarantine,
            recovered: state.recovered,
            deleted: state.deleted,
            wouldDelete: state.wouldDelete,
            notFound: state.notFound,
            failed: state.failed,
            skippedState: skippedState,
            skippedReferenced,
            candidateFileIds,
            quarantinedFileIds: state.quarantinedFileIds,
            wouldQuarantineFileIds: state.wouldQuarantineFileIds,
            recoveredFileIds: state.recoveredFileIds,
            deletedFileIds: state.deletedFileIds,
            wouldDeleteFileIds: state.wouldDeleteFileIds,
        };
    });
}
