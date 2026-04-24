import type { UploadPurpose } from "@/constants/upload-limits";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { collectReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import {
    deleteOrphanFileFromRepository,
    readStaleFileGcCandidatesFromRepository,
} from "@/server/repositories/files/file-cleanup.repository";

const DEFAULT_FILE_GC_RETENTION_HOURS = 24;
const DEFAULT_FILE_GC_BATCH_SIZE = 200;
const DEFAULT_FILE_GC_INTERVAL_MS = 900_000;

export const FILE_GC_TEMPORARY_PURPOSES: UploadPurpose[] = [
    "registration-avatar",
    "general",
];

type FileGcResult = {
    scanned: number;
    referenced: number;
    deleted: number;
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

function buildCreatedBeforeIso(now: Date): string {
    return new Date(
        now.getTime() - readFileGcRetentionHours() * 60 * 60 * 1000,
    ).toISOString();
}

export async function runFileGcBatch(
    now: Date = new Date(),
): Promise<FileGcResult> {
    return await withServiceRepositoryContext(async () => {
        const candidates = await readStaleFileGcCandidatesFromRepository({
            createdBefore: buildCreatedBeforeIso(now),
            temporaryPurposes: FILE_GC_TEMPORARY_PURPOSES,
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
                candidateFileIds: [],
                deletedFileIds: [],
            };
        }

        const referencedFileIds =
            await collectReferencedDirectusFileIds(candidateFileIds);
        const orphanFileIds = candidateFileIds.filter(
            (fileId) => !referencedFileIds.has(fileId),
        );

        for (const fileId of orphanFileIds) {
            await deleteOrphanFileFromRepository(fileId);
        }

        return {
            scanned: candidateFileIds.length,
            referenced: referencedFileIds.size,
            deleted: orphanFileIds.length,
            candidateFileIds,
            deletedFileIds: orphanFileIds,
        };
    });
}
