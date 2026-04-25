import type { AppFileDetachJob } from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    createOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { collectReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup-reference-utils";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { markFilesDetached } from "@/server/repositories/files/file-lifecycle.repository";
import { seedFileReferencesWhenEmpty } from "@/server/files/file-reference-shadow";
import {
    isResourceReferenceSyncJobSource,
    markResourceReferenceSyncJobSucceeded,
    parseResourceReferenceSyncJobPayload,
    replayResourceReferenceSyncJob,
} from "@/server/files/resource-lifecycle";

const DEFAULT_FILE_DETACH_JOB_INTERVAL_MS = 60_000;
const DEFAULT_FILE_DETACH_JOB_BATCH_SIZE = 50;
const DEFAULT_FILE_DETACH_JOB_LEASE_SECONDS = 300;
const MAX_RETRY_DELAY_MS = 60 * 60_000;

type FileDetachJobSourceCollection =
    | "app_albums"
    | "app_album_photos"
    | "app_articles"
    | "app_article_comments"
    | "app_diaries"
    | "app_diary_comments"
    | "app_diary_images";

const SOURCE_COLLECTION_BY_TYPE: Partial<
    Record<string, FileDetachJobSourceCollection>
> = {
    "admin.album.delete": "app_albums",
    "admin.album-photo.delete": "app_album_photos",
    "admin.article.delete": "app_articles",
    "admin.article-comment.delete": "app_article_comments",
    "admin.diary.delete": "app_diaries",
    "admin.diary-comment.delete": "app_diary_comments",
    "admin.diary-image.delete": "app_diary_images",
    "comment.article.delete": "app_article_comments",
    "comment.diary.delete": "app_diary_comments",
    "me.album.delete": "app_albums",
    "me.album-photo.delete": "app_album_photos",
    "me.article.delete": "app_articles",
    "me.diary.delete": "app_diaries",
    "me.diary-image.delete": "app_diary_images",
};

export type FileDetachJobRunResult = {
    status: "succeeded" | "pending" | "skipped";
    jobId: string;
    detached: number;
    skippedReferenced: number;
};

export type EnqueueFileDetachJobResult = {
    jobId: string;
    status: "pending" | "skipped";
    candidateFileIds: string[];
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

export function readFileDetachJobIntervalMs(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_DETACH_JOB_INTERVAL_MS ||
            import.meta.env.FILE_DETACH_JOB_INTERVAL_MS,
        DEFAULT_FILE_DETACH_JOB_INTERVAL_MS,
    );
}

export function readFileDetachJobBatchSize(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_DETACH_JOB_BATCH_SIZE ||
            import.meta.env.FILE_DETACH_JOB_BATCH_SIZE,
        DEFAULT_FILE_DETACH_JOB_BATCH_SIZE,
    );
}

export function readFileDetachJobLeaseSeconds(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_DETACH_JOB_LEASE_SECONDS ||
            import.meta.env.FILE_DETACH_JOB_LEASE_SECONDS,
        DEFAULT_FILE_DETACH_JOB_LEASE_SECONDS,
    );
}

function normalizeFileIds(values: unknown[]): string[] {
    const fileIds = new Set<string>();
    for (const value of values) {
        const fileId = normalizeDirectusFileId(value);
        if (fileId) {
            fileIds.add(fileId);
        }
    }
    return [...fileIds];
}

function buildDuePendingFilter(now: Date): JsonObject {
    return {
        _and: [
            { status: { _eq: "pending" } },
            {
                _or: [
                    { scheduled_at: { _null: true } },
                    { scheduled_at: { _lte: now.toISOString() } },
                ],
            },
        ],
    } as JsonObject;
}

function buildRetryDelayMs(attempts: number): number {
    const normalizedAttempts = Math.max(1, attempts);
    return Math.min(MAX_RETRY_DELAY_MS, 30_000 * 2 ** (normalizedAttempts - 1));
}

function classifyDetachJobError(error: unknown): {
    code: string;
    message: string;
} {
    const message =
        error instanceof Error ? error.message : "文件 detach job 处理失败";
    const lower = message.toLowerCase();
    if (
        lower.includes("network") ||
        lower.includes("fetch") ||
        lower.includes("timeout") ||
        lower.includes("socket") ||
        lower.includes("econn") ||
        lower.includes("connect")
    ) {
        return { code: "DIRECTUS_NETWORK", message };
    }
    if (
        lower.includes("forbidden") ||
        lower.includes("permission") ||
        lower.includes("unauthorized") ||
        lower.includes("403") ||
        lower.includes("401")
    ) {
        return { code: "DIRECTUS_PERMISSION", message };
    }
    return { code: "UNKNOWN", message };
}

function readJobCandidateFileIds(job: AppFileDetachJob): string[] {
    return normalizeFileIds(
        Array.isArray(job.candidate_file_ids) ? job.candidate_file_ids : [],
    );
}

async function readFileDetachJob(
    jobId: string,
): Promise<AppFileDetachJob | null> {
    const rows = await readMany("app_file_detach_jobs", {
        filter: { id: { _eq: jobId } } as JsonObject,
        limit: 1,
        fields: [
            "id",
            "status",
            "source_type",
            "source_id",
            "candidate_file_ids",
            "attempts",
            "scheduled_at",
            "leased_until",
        ],
    });
    return rows[0] ?? null;
}

async function isDetachJobSourceDeleted(
    job: AppFileDetachJob,
): Promise<boolean> {
    if (!job.source_id) {
        return true;
    }
    const collection = SOURCE_COLLECTION_BY_TYPE[job.source_type];
    if (!collection) {
        return true;
    }
    const row = await readOneById(collection, job.source_id, {
        fields: ["id"],
    });
    return row === null;
}

export async function enqueueFileDetachJob(input: {
    sourceType: string;
    sourceId?: string | null;
    fileValues: unknown[];
    scheduledAt?: string;
}): Promise<EnqueueFileDetachJobResult> {
    return await withServiceRepositoryContext(async () => {
        const candidateFileIds = normalizeFileIds(input.fileValues);
        const now = input.scheduledAt || new Date().toISOString();
        const status = candidateFileIds.length > 0 ? "pending" : "skipped";
        const created = await createOne(
            "app_file_detach_jobs",
            {
                status,
                source_type: input.sourceType,
                source_id: input.sourceId ?? null,
                candidate_file_ids: candidateFileIds,
                detached_file_ids: [],
                skipped_referenced_file_ids: [],
                attempts: 0,
                scheduled_at: status === "pending" ? now : null,
                leased_until: null,
                started_at: null,
                finished_at: status === "skipped" ? now : null,
                error_code: null,
                error_message: null,
            },
            { fields: ["id", "status", "candidate_file_ids"] },
        );

        return {
            jobId: created.id,
            status,
            candidateFileIds,
        };
    });
}

export async function readPendingFileDetachJobs(
    limit: number,
    now = new Date(),
): Promise<string[]> {
    return await withServiceRepositoryContext(async () => {
        const rows = await readMany("app_file_detach_jobs", {
            filter: buildDuePendingFilter(now),
            sort: ["scheduled_at", "date_created"],
            limit,
            fields: ["id"],
        });
        return rows.map((row) => row.id);
    });
}

export async function recoverStuckFileDetachJobs(
    now = new Date(),
): Promise<number> {
    return await withServiceRepositoryContext(async () => {
        const rows = await readMany("app_file_detach_jobs", {
            filter: {
                _and: [
                    { status: { _eq: "processing" } },
                    { leased_until: { _lt: now.toISOString() } },
                ],
            } as JsonObject,
            limit: 100,
            fields: ["id"],
        });

        await Promise.all(
            rows.map(async (job) => {
                await updateOne("app_file_detach_jobs", job.id, {
                    status: "pending",
                    scheduled_at: now.toISOString(),
                    leased_until: null,
                    error_code: "LEASE_EXPIRED",
                    error_message: "文件 detach job lease 已过期，已重新入队",
                });
            }),
        );
        return rows.length;
    });
}

export async function runFileDetachJob(
    jobId: string,
    now: Date = new Date(),
): Promise<FileDetachJobRunResult> {
    return await withServiceRepositoryContext(async () => {
        const job = await readFileDetachJob(jobId);
        if (!job || job.status !== "pending") {
            return {
                status: "skipped",
                jobId,
                detached: 0,
                skippedReferenced: 0,
            };
        }

        const nowIso = now.toISOString();
        const attempts = job.attempts + 1;
        const candidateFileIds = readJobCandidateFileIds(job);

        try {
            if (!(await isDetachJobSourceDeleted(job))) {
                await updateOne("app_file_detach_jobs", job.id, {
                    status: "pending",
                    attempts,
                    scheduled_at: new Date(
                        now.getTime() + buildRetryDelayMs(attempts),
                    ).toISOString(),
                    leased_until: null,
                    started_at: null,
                    finished_at: null,
                    error_code: "SOURCE_NOT_DELETED",
                    error_message:
                        "文件 detach job 的源记录尚未删除，已重新排期",
                });
                return {
                    status: "pending",
                    jobId: job.id,
                    detached: 0,
                    skippedReferenced: 0,
                };
            }

            await updateOne("app_file_detach_jobs", job.id, {
                status: "processing",
                attempts,
                started_at: nowIso,
                leased_until: new Date(
                    now.getTime() + readFileDetachJobLeaseSeconds() * 1_000,
                ).toISOString(),
                error_code: null,
                error_message: null,
            });

            if (isResourceReferenceSyncJobSource(job.source_type)) {
                const payload = parseResourceReferenceSyncJobPayload(
                    job.candidate_file_ids,
                );
                if (!payload) {
                    await updateOne("app_file_detach_jobs", job.id, {
                        status: "skipped",
                        scheduled_at: null,
                        leased_until: null,
                        finished_at: nowIso,
                        detached_file_ids: [],
                        skipped_referenced_file_ids: [],
                        error_code: "INVALID_PAYLOAD",
                        error_message:
                            "resource reference sync job payload 无效",
                    });
                    return {
                        status: "skipped",
                        jobId: job.id,
                        detached: 0,
                        skippedReferenced: 0,
                    };
                }
                await replayResourceReferenceSyncJob(payload);
                await markResourceReferenceSyncJobSucceeded({
                    jobId: job.id,
                    nowIso,
                });
                return {
                    status: "succeeded",
                    jobId: job.id,
                    detached: 0,
                    skippedReferenced: 0,
                };
            }

            if (candidateFileIds.length === 0) {
                await updateOne("app_file_detach_jobs", job.id, {
                    status: "skipped",
                    scheduled_at: null,
                    leased_until: null,
                    finished_at: nowIso,
                    detached_file_ids: [],
                    skipped_referenced_file_ids: [],
                });
                return {
                    status: "skipped",
                    jobId: job.id,
                    detached: 0,
                    skippedReferenced: 0,
                };
            }

            await seedFileReferencesWhenEmpty();
            const referencedFileIds =
                await collectReferencedDirectusFileIds(candidateFileIds);
            const skippedReferencedFileIds = candidateFileIds.filter((fileId) =>
                referencedFileIds.has(fileId),
            );
            const detachedFileIds = candidateFileIds.filter(
                (fileId) => !referencedFileIds.has(fileId),
            );

            if (detachedFileIds.length > 0) {
                await markFilesDetached(detachedFileIds, nowIso);
            }

            const status = detachedFileIds.length > 0 ? "succeeded" : "skipped";
            await updateOne("app_file_detach_jobs", job.id, {
                status,
                scheduled_at: null,
                leased_until: null,
                finished_at: nowIso,
                detached_file_ids: detachedFileIds,
                skipped_referenced_file_ids: skippedReferencedFileIds,
                error_code: null,
                error_message: null,
            });

            return {
                status,
                jobId: job.id,
                detached: detachedFileIds.length,
                skippedReferenced: skippedReferencedFileIds.length,
            };
        } catch (error) {
            const classified = classifyDetachJobError(error);
            await updateOne("app_file_detach_jobs", job.id, {
                status: "pending",
                scheduled_at: new Date(
                    now.getTime() + buildRetryDelayMs(attempts),
                ).toISOString(),
                leased_until: null,
                finished_at: null,
                error_code: classified.code,
                error_message: classified.message,
            });

            return {
                status: "pending",
                jobId: job.id,
                detached: 0,
                skippedReferenced: 0,
            };
        }
    });
}

export async function runFileDetachJobBestEffort(params: {
    jobId: string;
    label: string;
}): Promise<void> {
    try {
        await runFileDetachJob(params.jobId);
    } catch (error) {
        console.warn(
            `[file-detach-job] immediate run failed: ${params.label}`,
            error,
        );
    }
}
