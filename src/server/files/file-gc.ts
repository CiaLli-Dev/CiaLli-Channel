import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { collectReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import {
    deleteOrphanFileFromRepository,
    readStaleFileGcCandidatesFromRepository,
} from "@/server/repositories/files/file-cleanup.repository";
import {
    claimFileForDelete,
    claimFileForQuarantine,
    markFileDeleteDeadLetter,
    markFileDeleteRetry,
    markFilesAttached,
    readManagedFilesByIds,
} from "@/server/repositories/files/file-lifecycle.repository";
import { seedFileReferencesWhenEmpty } from "@/server/files/file-reference-shadow";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";

const DEFAULT_FILE_GC_RETENTION_HOURS = 168;
const DEFAULT_FILE_GC_QUARANTINE_DAYS = 7;
const DEFAULT_FILE_GC_BATCH_SIZE = 200;
const DEFAULT_FILE_GC_INTERVAL_MS = 900_000;
const DEFAULT_FILE_GC_DELETE_MAX_ATTEMPTS = 6;
const FILE_GC_DELETE_LEASE_MS = 15 * 60_000;
const FILE_GC_DELETE_RETRY_BASE_MS = 15 * 60_000;
const FILE_GC_DELETE_RETRY_MAX_MS = 24 * 60 * 60_000;

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
    deadLettered: number;
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
    deadLetteredFileIds: string[];
};

type FileGcOptions = {
    dryRun?: boolean;
};

type FileGcCutoffs = {
    detachedBefore: string;
    quarantinedBefore: string;
    deleteRetryBefore: string;
};

type FileGcMutableResult = {
    quarantined: number;
    wouldQuarantine: number;
    recovered: number;
    deleted: number;
    wouldDelete: number;
    deadLettered: number;
    notFound: number;
    failed: number;
    finalSkippedState: number;
    finalSkippedReferenced: number;
    quarantinedFileIds: string[];
    wouldQuarantineFileIds: string[];
    recoveredFileIds: string[];
    deletedFileIds: string[];
    wouldDeleteFileIds: string[];
    deadLetteredFileIds: string[];
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

export function readFileGcDeleteMaxAttempts(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_GC_DELETE_MAX_ATTEMPTS ||
            import.meta.env.FILE_GC_DELETE_MAX_ATTEMPTS,
        DEFAULT_FILE_GC_DELETE_MAX_ATTEMPTS,
    );
}

export function readFileGcIntervalMs(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_GC_INTERVAL_MS || import.meta.env.FILE_GC_INTERVAL_MS,
        DEFAULT_FILE_GC_INTERVAL_MS,
    );
}

function buildDeleteRetryDelayMs(attempts: number): number {
    const normalizedAttempts = Math.max(1, attempts);
    return Math.min(
        FILE_GC_DELETE_RETRY_MAX_MS,
        FILE_GC_DELETE_RETRY_BASE_MS * 2 ** (normalizedAttempts - 1),
    );
}

function buildDeleteLeaseUntilIso(now: Date): string {
    return new Date(now.getTime() + FILE_GC_DELETE_LEASE_MS).toISOString();
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
        | "deleting"
        | "deleted"
        | "delete_failed"
        | "protected"
        | null;
    app_detached_at?: string | null;
    app_quarantined_at?: string | null;
    app_deleted_at?: string | null;
    app_delete_attempts?: number | null;
    app_delete_next_retry_at?: string | null;
    app_delete_last_error?: string | null;
    app_delete_dead_lettered_at?: string | null;
};

function readGcPhase(
    row: ManagedFileGcState | undefined,
    cutoffs: FileGcCutoffs,
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
    if (row.app_lifecycle === "deleted" || row.app_lifecycle === "deleting") {
        return !row.app_delete_next_retry_at ||
            row.app_delete_next_retry_at <= cutoffs.deleteRetryBefore
            ? "delete"
            : null;
    }
    return null;
}

function readDeleteAttempts(row: ManagedFileGcState | undefined): number {
    const attempts = row?.app_delete_attempts;
    return typeof attempts === "number" && Number.isFinite(attempts)
        ? Math.max(0, Math.floor(attempts))
        : 0;
}

function readAuditLifecycle(row: ManagedFileGcState | undefined): string {
    return row?.app_lifecycle || "unknown";
}

function readErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
        deadLettered: 0,
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
        deadLetteredFileIds: [],
    };
}

function createMutableFileGcResult(): FileGcMutableResult {
    return {
        quarantined: 0,
        wouldQuarantine: 0,
        recovered: 0,
        deleted: 0,
        wouldDelete: 0,
        deadLettered: 0,
        notFound: 0,
        failed: 0,
        finalSkippedState: 0,
        finalSkippedReferenced: 0,
        quarantinedFileIds: [],
        wouldQuarantineFileIds: [],
        recoveredFileIds: [],
        deletedFileIds: [],
        wouldDeleteFileIds: [],
        deadLetteredFileIds: [],
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
        | "dead_lettered"
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

function recordFileProcessingFailure(params: {
    fileId: string;
    dryRun: boolean;
    cutoffs: FileGcCutoffs;
    lifecycle: string;
    state: FileGcMutableResult;
    reason: string;
    error: unknown;
}): void {
    params.state.failed += 1;
    logFileGcAudit({
        fileId: params.fileId,
        dryRun: params.dryRun,
        detachedBefore: params.cutoffs.detachedBefore,
        quarantinedBefore: params.cutoffs.quarantinedBefore,
        lifecycle: params.lifecycle,
        outcome: "failed",
        reason: params.reason,
        message: readErrorMessage(params.error),
    });
}

async function recoverReferencedFileId(params: {
    fileId: string;
    dryRun: boolean;
    cutoffs: FileGcCutoffs;
    currentLifecycleById: Map<string, ManagedFileGcState>;
    state: FileGcMutableResult;
}): Promise<void> {
    if (params.dryRun) {
        return;
    }

    const lifecycleRow = params.currentLifecycleById.get(params.fileId);
    const recoveredFileIds: string[] = [];
    if (lifecycleRow?.app_lifecycle === "quarantined") {
        const restored = await resourceLifecycle.restoreQuarantinedFiles({
            fileIds: [params.fileId],
            requireReference: true,
        });
        recoveredFileIds.push(...restored.restoredFileIds);
    } else {
        await markFilesAttached({
            fileIds: [params.fileId],
            allowLifecycleOverride: true,
        });
        recoveredFileIds.push(params.fileId);
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

    for (const fileId of params.fileIds) {
        try {
            await recoverReferencedFileId({ ...params, fileId });
        } catch (error) {
            recordFileProcessingFailure({
                fileId,
                dryRun: params.dryRun,
                cutoffs: params.cutoffs,
                lifecycle: readAuditLifecycle(
                    params.currentLifecycleById.get(fileId),
                ),
                state: params.state,
                reason: "referenced_recovery_failed",
                error,
            });
        }
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
    const claimed = await claimFileForQuarantine({
        fileId: params.fileId,
        detachedBefore: params.cutoffs.detachedBefore,
        quarantinedAt: params.now.toISOString(),
    });
    if (!claimed) {
        params.state.finalSkippedState += 1;
        return;
    }
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
    const previousAttempts = readDeleteAttempts(params.row);
    const nowIso = params.now.toISOString();
    const retryAfter = buildDeleteLeaseUntilIso(params.now);

    const claimed = await claimFileForDelete({
        fileId: params.fileId,
        deletedAt: nowIso,
        retryAfter,
        quarantinedBefore: params.cutoffs.quarantinedBefore,
        deleteRetryBefore: params.cutoffs.deleteRetryBefore,
    });
    if (!claimed) {
        params.state.finalSkippedState += 1;
        return;
    }

    const postClaimReferencedFileIds = await collectReferencedDirectusFileIds([
        params.fileId,
    ]);
    if (postClaimReferencedFileIds.has(params.fileId)) {
        await markFilesAttached({
            fileIds: [params.fileId],
            allowLifecycleOverride: true,
        });
        params.state.recovered += 1;
        params.state.recoveredFileIds.push(params.fileId);
        params.state.finalSkippedReferenced += 1;
        logFileGcAudit({
            fileId: params.fileId,
            dryRun: params.dryRun,
            detachedBefore: params.cutoffs.detachedBefore,
            quarantinedBefore: params.cutoffs.quarantinedBefore,
            lifecycle: params.lifecycle,
            outcome: "recovered",
            reason: "referenced_after_delete_claim",
        });
        return;
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

    const attempts = previousAttempts + 1;
    const maxAttempts = readFileGcDeleteMaxAttempts();
    if (attempts >= maxAttempts) {
        await markFileDeleteDeadLetter({
            fileId: params.fileId,
            attempts,
            deadLetteredAt: nowIso,
            lastError: result.reason,
        });
        params.state.deadLettered += 1;
        params.state.deadLetteredFileIds.push(params.fileId);
        logFileGcAudit({
            fileId: params.fileId,
            dryRun: params.dryRun,
            detachedBefore: params.cutoffs.detachedBefore,
            quarantinedBefore: params.cutoffs.quarantinedBefore,
            lifecycle: params.lifecycle,
            outcome: "dead_lettered",
            reason: result.reason,
        });
        return;
    }

    await markFileDeleteRetry({
        fileId: params.fileId,
        attempts,
        nextRetryAt: new Date(
            params.now.getTime() + buildDeleteRetryDelayMs(attempts),
        ).toISOString(),
        lastError: result.reason,
    });
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

async function processOrphanFileBestEffort(params: {
    fileId: string;
    now: Date;
    dryRun: boolean;
    cutoffs: FileGcCutoffs;
    currentLifecycleById: Map<string, ManagedFileGcState>;
    state: FileGcMutableResult;
}): Promise<void> {
    try {
        await processOrphanFile(params);
    } catch (error) {
        recordFileProcessingFailure({
            fileId: params.fileId,
            dryRun: params.dryRun,
            cutoffs: params.cutoffs,
            lifecycle: readAuditLifecycle(
                params.currentLifecycleById.get(params.fileId),
            ),
            state: params.state,
            reason: "candidate_processing_failed",
            error,
        });
    }
}

export async function runFileGcBatch(
    now: Date = new Date(),
    options: FileGcOptions = {},
): Promise<FileGcResult> {
    return await withServiceRepositoryContext(async () => {
        const dryRun = options.dryRun === true;
        const detachedBefore = buildDetachedBeforeIso(now);
        const quarantinedBefore = buildQuarantinedBeforeIso(now);
        const deleteRetryBefore = now.toISOString();
        const candidates = await readStaleFileGcCandidatesFromRepository({
            detachedBefore,
            quarantinedBefore,
            deleteRetryBefore,
            limit: readFileGcBatchSize(),
        });
        const candidateFileIds = candidates
            .map((candidate) => String(candidate.id || "").trim())
            .filter(Boolean);

        if (candidateFileIds.length === 0) {
            return createEmptyFileGcResult(dryRun);
        }

        await seedFileReferencesWhenEmpty();
        const [referencedFileIds, currentLifecycleRows] = await Promise.all([
            collectReferencedDirectusFileIds(candidateFileIds),
            readManagedFilesByIds(candidateFileIds),
        ]);
        const currentLifecycleById = new Map(
            currentLifecycleRows.map((row) => [row.id, row]),
        );
        const cutoffs = {
            detachedBefore,
            quarantinedBefore,
            deleteRetryBefore,
        };
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
            await processOrphanFileBestEffort({
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
            deadLettered: state.deadLettered,
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
            deadLetteredFileIds: state.deadLetteredFileIds,
        };
    });
}
