import type {
    AiSummaryJobKind,
    AiSummaryTargetLength,
    AppAiSummaryJob,
    AppArticle,
} from "@/types/app";
import { randomUUID } from "node:crypto";

import type { JsonObject } from "@/types/json";
import { createOne, readMany, updateOne } from "@/server/directus/client";
import { getRedisClient } from "@/server/redis/client";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { getResolvedSiteSettings } from "@/server/site-settings/service";

import { buildSummaryContentHash, buildSummaryJobDedupeKey } from "./hash";
import type { DecryptedAiSettings } from "./config";
import { resolveAiSummaryPromptVersion } from "./prompts";

export type EnqueueSummaryJobResult = {
    jobId: string | null;
    status: "pending" | "skipped";
    reason?: string;
};

export type ArticleAiSummaryJobSnapshot = Pick<
    AppAiSummaryJob,
    | "id"
    | "status"
    | "error_message"
    | "date_created"
    | "started_at"
    | "finished_at"
>;

const SUMMARY_JOB_FIELDS = [
    "id",
    "status",
    "article_id",
    "attempts",
    "max_attempts",
    "content_hash",
    "prompt_version",
    "model",
    "target_length",
    "scheduled_at",
    "leased_until",
] as const;

const DEFAULT_JOB_LEASE_SECONDS = 600;
const DEFAULT_PENDING_JOB_BATCH_SIZE = 3;
const LOCK_KEY_PREFIX = "ai-summary:job-lock";
const STUCK_JOB_ERROR_MESSAGE = "AI 服务请求超时";

export type AiSummaryJobLock = {
    jobId: string;
    owner: string;
};

function readPositiveInt(value: string, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

export function readAiSummaryJobLeaseSeconds(): number {
    return readPositiveInt(
        String(
            process.env.AI_SUMMARY_JOB_LEASE_SECONDS ||
                import.meta.env.AI_SUMMARY_JOB_LEASE_SECONDS ||
                "",
        ).trim(),
        DEFAULT_JOB_LEASE_SECONDS,
    );
}

export function readAiSummaryJobBatchSize(): number {
    return readPositiveInt(
        String(
            process.env.AI_SUMMARY_JOB_BATCH_SIZE ||
                import.meta.env.AI_SUMMARY_JOB_BATCH_SIZE ||
                "",
        ).trim(),
        DEFAULT_PENDING_JOB_BATCH_SIZE,
    );
}

function buildJobLockKey(jobId: string): string {
    return `${LOCK_KEY_PREFIX}:${jobId}`;
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

function hasUsableAiSettings(settings: DecryptedAiSettings): boolean {
    return Boolean(
        settings.enabled &&
        settings.articleSummaryEnabled &&
        settings.baseUrl &&
        settings.model &&
        settings.apiKey,
    );
}

function isEncryptedBody(bodyMarkdown: string): boolean {
    return String(bodyMarkdown || "")
        .trim()
        .startsWith("CL2:");
}

function canAiSummaryOverwrite(article: AppArticle): boolean {
    const summary = String(article.summary || "").trim();
    return !summary || article.summary_source === "ai";
}

async function readArticle(articleId: string): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: { id: { _eq: articleId } } as JsonObject,
        limit: 1,
        fields: [
            "id",
            "author_id",
            "status",
            "title",
            "summary",
            "summary_source",
            "summary_content_hash",
            "summary_prompt_version",
            "summary_error",
            "ai_summary_enabled",
            "body_markdown",
        ],
    });
    return rows[0] ?? null;
}

async function readExistingJob(
    dedupeKey: string,
): Promise<AppAiSummaryJob | null> {
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_ai_summary_jobs", {
                filter: { dedupe_key: { _eq: dedupeKey } } as JsonObject,
                limit: 1,
                fields: [...SUMMARY_JOB_FIELDS],
            }),
    );
    return rows[0] ?? null;
}

async function clearArticleSummaryError(articleId: string): Promise<void> {
    await withServiceRepositoryContext(async () => {
        await updateOne("app_articles", articleId, {
            summary_error: null,
        });
    });
}

function buildSkip(reason: string): EnqueueSummaryJobResult {
    return { jobId: null, status: "skipped", reason };
}

function resolveArticleSkipReason(
    article: AppArticle | null,
    settings: DecryptedAiSettings,
    force: boolean,
): string | null {
    if (!hasUsableAiSettings(settings)) {
        return "config_missing";
    }
    if (!article) {
        return "article_not_found";
    }
    if (article.status !== "published") {
        return "article_not_published";
    }
    if (!article.ai_summary_enabled) {
        return "article_ai_summary_disabled";
    }
    if (!String(article.body_markdown || "").trim()) {
        return "article_body_empty";
    }
    if (isEncryptedBody(article.body_markdown)) {
        return "article_body_encrypted";
    }
    if (!force && !canAiSummaryOverwrite(article)) {
        return "manual_summary_locked";
    }
    return null;
}

export async function enqueueArticleSummaryJob(input: {
    articleId: string;
    settings: DecryptedAiSettings;
    kind?: AiSummaryJobKind;
    force?: boolean;
    targetLength?: AiSummaryTargetLength;
}): Promise<EnqueueSummaryJobResult> {
    const article = await readArticle(input.articleId);
    const skipReason = resolveArticleSkipReason(
        article,
        input.settings,
        input.force === true,
    );
    if (skipReason || !article) {
        return buildSkip(skipReason || "article_not_found");
    }

    const targetLength = input.targetLength ?? "medium";
    const siteSettings = await getResolvedSiteSettings();
    const promptVersion = resolveAiSummaryPromptVersion(
        siteSettings.system.lang,
    );
    const contentHash = buildSummaryContentHash({
        title: article.title,
        bodyMarkdown: article.body_markdown,
    });
    // 摘要新鲜度不仅取决于正文内容，也取决于当前站点语言。
    // 站点语言切换后，即使正文哈希不变，也需要重新生成对应语言的摘要。
    if (
        !input.force &&
        article.summary_source === "ai" &&
        article.summary_content_hash === contentHash &&
        article.summary_prompt_version === promptVersion
    ) {
        return buildSkip("ai_summary_fresh");
    }

    const dedupeKey = buildSummaryJobDedupeKey({
        articleId: article.id,
        contentHash,
        promptVersion,
        targetLength,
    });
    const existing = await readExistingJob(dedupeKey);
    if (existing) {
        await clearArticleSummaryError(article.id);
        return { jobId: existing.id, status: "pending" };
    }

    const created = await withServiceRepositoryContext(
        async () =>
            await createOne(
                "app_ai_summary_jobs",
                {
                    article_id: article.id,
                    author_id: article.author_id,
                    status: "pending",
                    kind: input.kind ?? "on_publish",
                    priority: input.kind === "manual" ? 10 : 0,
                    dedupe_key: dedupeKey,
                    content_hash: contentHash,
                    prompt_version: promptVersion,
                    provider: "openai-compatible",
                    model: input.settings.model,
                    target_length: targetLength,
                    attempts: 0,
                    max_attempts: 3,
                    scheduled_at: new Date().toISOString(),
                },
                { fields: ["id"] },
            ),
    );
    await clearArticleSummaryError(article.id);

    return { jobId: created.id, status: "pending" };
}

export async function readPendingSummaryJobs(
    limit: number,
    now = new Date(),
): Promise<string[]> {
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_ai_summary_jobs", {
                filter: buildDuePendingFilter(now),
                sort: ["-priority", "scheduled_at"],
                limit,
                fields: ["id"],
            }),
    );
    return rows.map((row) => row.id);
}

export async function readLatestArticleSummaryJob(
    articleId: string,
): Promise<ArticleAiSummaryJobSnapshot | null> {
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_ai_summary_jobs", {
                filter: { article_id: { _eq: articleId } } as JsonObject,
                sort: ["-date_created"],
                limit: 1,
                fields: [
                    "id",
                    "status",
                    "error_message",
                    "date_created",
                    "started_at",
                    "finished_at",
                ],
            }),
    );

    return rows[0] ?? null;
}

export async function recoverStuckSummaryJobs(
    now = new Date(),
): Promise<number> {
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_ai_summary_jobs", {
                filter: {
                    _and: [
                        { status: { _eq: "processing" } },
                        { leased_until: { _lt: now.toISOString() } },
                    ],
                } as JsonObject,
                limit: 100,
                fields: ["id", "article_id", "attempts", "max_attempts"],
            }),
    );

    await withServiceRepositoryContext(async () => {
        await Promise.all(
            rows.map(async (job) => {
                const failed = job.attempts >= job.max_attempts;

                await updateOne("app_ai_summary_jobs", job.id, {
                    status: failed ? "failed" : "pending",
                    leased_until: null,
                    scheduled_at: failed ? null : now.toISOString(),
                    finished_at: failed ? now.toISOString() : null,
                    error_code: failed ? "PROVIDER_TIMEOUT" : null,
                    error_message: failed ? STUCK_JOB_ERROR_MESSAGE : null,
                });

                if (failed) {
                    await updateOne("app_articles", job.article_id, {
                        summary_error: STUCK_JOB_ERROR_MESSAGE,
                    });
                }
            }),
        );
    });
    return rows.length;
}

export async function acquireAiSummaryJobLock(
    jobId: string,
): Promise<AiSummaryJobLock | null> {
    const redis = getRedisClient();
    if (!redis) {
        return null;
    }

    const owner = randomUUID();
    const result = await redis.set(buildJobLockKey(jobId), owner, {
        ex: readAiSummaryJobLeaseSeconds(),
        nx: true,
    });
    if (result !== "OK") {
        return null;
    }

    return { jobId, owner };
}

export async function releaseAiSummaryJobLock(
    lock: AiSummaryJobLock | null,
): Promise<void> {
    if (!lock) {
        return;
    }

    const redis = getRedisClient();
    if (!redis) {
        return;
    }

    await redis.delIfValue(buildJobLockKey(lock.jobId), lock.owner);
}
