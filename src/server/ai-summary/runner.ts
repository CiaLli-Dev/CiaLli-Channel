import type { AppAiSummaryJob, AppArticle } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import { readMany, updateOne } from "@/server/directus/client";

import type { DecryptedAiSettings } from "./config";
import { classifyAiSummaryError, buildRetryDelayMs } from "./errors";
import { buildSummaryContentHash } from "./hash";
import {
    buildChunkSummaryMessages,
    buildFinalSummaryMessages,
} from "./prompts";
import { callOpenAICompatibleChatCompletion } from "./provider";
import { splitMarkdownForSummary } from "./splitter";

type RunAiSummaryJobInput = {
    jobId: string;
    settings: DecryptedAiSettings;
    fetch?: typeof fetch;
    now?: Date;
};

export type RunAiSummaryJobResult = {
    status: "succeeded" | "failed" | "pending" | "skipped";
    jobId: string;
};

async function readJob(jobId: string): Promise<AppAiSummaryJob | null> {
    const rows = await readMany("app_ai_summary_jobs", {
        filter: { id: { _eq: jobId } } as JsonObject,
        limit: 1,
        fields: [
            "id",
            "article_id",
            "status",
            "attempts",
            "max_attempts",
            "content_hash",
            "prompt_version",
            "model",
            "target_length",
        ],
    });
    return rows[0] ?? null;
}

async function readArticle(articleId: string): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: { id: { _eq: articleId } } as JsonObject,
        limit: 1,
        fields: [
            "id",
            "short_id",
            "slug",
            "author_id",
            "status",
            "title",
            "summary",
            "summary_source",
            "ai_summary_enabled",
            "body_markdown",
        ],
    });
    return rows[0] ?? null;
}

function canRun(settings: DecryptedAiSettings): boolean {
    return Boolean(
        settings.enabled &&
        settings.articleSummaryEnabled &&
        settings.baseUrl &&
        settings.model &&
        settings.apiKey,
    );
}

function canOverwriteArticleSummary(article: AppArticle): boolean {
    const summary = String(article.summary || "").trim();
    return !summary || article.summary_source === "ai";
}

function buildDetailInvalidationTasks(
    article: AppArticle,
): Array<Promise<void>> {
    const keys = [article.id, article.short_id, article.slug]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    return keys.map((key) => cacheManager.invalidate("article-detail", key));
}

async function markJobSkipped(
    job: AppAiSummaryJob,
    reason: string,
    now: Date,
): Promise<RunAiSummaryJobResult> {
    await updateOne("app_ai_summary_jobs", job.id, {
        status: "skipped",
        error_code: "ARTICLE_SKIPPED",
        error_message: reason,
        finished_at: now.toISOString(),
    });
    return { status: "skipped", jobId: job.id };
}

async function generateSummary(input: {
    article: AppArticle;
    settings: DecryptedAiSettings;
    fetch?: typeof fetch;
}): Promise<{
    summary: string;
    inputChars: number;
    chunkCount: number;
    outputChars: number;
}> {
    const chunks = splitMarkdownForSummary(input.article.body_markdown);
    const chunkSummaries: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
        const chunkSummary = await callOpenAICompatibleChatCompletion({
            fetch: input.fetch,
            baseUrl: input.settings.baseUrl,
            apiKey: input.settings.apiKey || "",
            model: input.settings.model,
            messages: buildChunkSummaryMessages({
                title: input.article.title,
                chunk: chunks[index] ?? "",
                chunkIndex: index,
                chunkCount: chunks.length,
            }),
            maxTokens: 500,
        });
        chunkSummaries.push(chunkSummary);
    }

    const summary =
        chunkSummaries.length === 1
            ? (chunkSummaries[0] ?? "")
            : await callOpenAICompatibleChatCompletion({
                  fetch: input.fetch,
                  baseUrl: input.settings.baseUrl,
                  apiKey: input.settings.apiKey || "",
                  model: input.settings.model,
                  messages: buildFinalSummaryMessages({
                      title: input.article.title,
                      chunkSummaries,
                  }),
                  maxTokens: 300,
              });

    return {
        summary: summary.trim(),
        inputChars: input.article.body_markdown.length,
        chunkCount: chunks.length,
        outputChars: summary.length,
    };
}

async function handleJobFailure(params: {
    job: AppAiSummaryJob;
    error: unknown;
    now: Date;
}): Promise<RunAiSummaryJobResult> {
    const classified = classifyAiSummaryError(params.error);
    const attempts = params.job.attempts + 1;
    const failed = !classified.retryable || attempts >= params.job.max_attempts;
    const scheduledAt = new Date(
        params.now.getTime() + buildRetryDelayMs(attempts),
    ).toISOString();

    await updateOne("app_ai_summary_jobs", params.job.id, {
        status: failed ? "failed" : "pending",
        scheduled_at: failed ? null : scheduledAt,
        leased_until: null,
        finished_at: failed ? params.now.toISOString() : null,
        error_code: classified.code,
        error_message: classified.message,
    });

    return {
        status: failed ? "failed" : "pending",
        jobId: params.job.id,
    };
}

export async function runAiSummaryJob(
    input: RunAiSummaryJobInput,
): Promise<RunAiSummaryJobResult> {
    const now = input.now ?? new Date();
    const job = await readJob(input.jobId);
    if (!job) {
        return { status: "skipped", jobId: input.jobId };
    }
    if (job.status !== "pending") {
        return { status: "skipped", jobId: job.id };
    }

    await updateOne("app_ai_summary_jobs", job.id, {
        status: "processing",
        attempts: job.attempts + 1,
        started_at: now.toISOString(),
        leased_until: new Date(now.getTime() + 10 * 60_000).toISOString(),
    });

    try {
        if (!canRun(input.settings)) {
            return await markJobSkipped(job, "config_missing", now);
        }
        const article = await readArticle(job.article_id);
        if (!article) {
            return await markJobSkipped(job, "article_not_found", now);
        }
        if (
            article.status !== "published" ||
            !article.ai_summary_enabled ||
            String(article.body_markdown || "")
                .trim()
                .startsWith("CL2:") ||
            !canOverwriteArticleSummary(article)
        ) {
            return await markJobSkipped(job, "article_not_eligible", now);
        }

        const generated = await generateSummary({
            article,
            settings: input.settings,
            fetch: input.fetch,
        });
        const contentHash = buildSummaryContentHash({
            title: article.title,
            bodyMarkdown: article.body_markdown,
        });

        await updateOne(
            "app_articles",
            article.id,
            {
                summary: generated.summary,
                summary_source: "ai",
                summary_generated_at: now.toISOString(),
                summary_model: input.settings.model,
                summary_prompt_version: job.prompt_version,
                summary_content_hash: contentHash,
                summary_error: null,
            },
            {
                fields: [
                    "id",
                    "summary",
                    "summary_source",
                    "summary_content_hash",
                ],
            },
        );
        await updateOne("app_ai_summary_jobs", job.id, {
            status: "succeeded",
            finished_at: now.toISOString(),
            leased_until: null,
            input_chars: generated.inputChars,
            chunk_count: generated.chunkCount,
            output_chars: generated.outputChars,
            result_summary: generated.summary,
            error_code: null,
            error_message: null,
        });
        await awaitCacheInvalidations(
            [
                cacheManager.invalidateByDomain("article-list"),
                cacheManager.invalidateByDomain("article-public"),
                ...buildDetailInvalidationTasks(article),
                cacheManager.invalidateByDomain("mixed-feed"),
            ],
            { label: "ai-summary#run" },
        );
        return { status: "succeeded", jobId: job.id };
    } catch (error) {
        return await handleJobFailure({ job, error, now });
    }
}
