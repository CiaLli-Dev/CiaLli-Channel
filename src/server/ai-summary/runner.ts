import type { AppAiSummaryJob, AppArticle } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import { readMany, updateMany, updateOne } from "@/server/directus/client";
import { getResolvedSiteSettings } from "@/server/site-settings/service";

import type { DecryptedAiSettings } from "./config";
import {
    AiSummaryError,
    buildRetryDelayMs,
    classifyAiSummaryError,
} from "./errors";
import { buildSummaryContentHash } from "./hash";
import {
    acquireAiSummaryJobLock,
    readAiSummaryJobLeaseSeconds,
    releaseAiSummaryJobLock,
} from "./jobs";
import {
    buildChunkSummaryMessages,
    buildFinalSummaryMessages,
    normalizeAiSummaryText,
    resolveAiSummaryLengthConfig,
    resolveAiSummaryPromptVersion,
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
            "scheduled_at",
            "leased_until",
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
            "summary_content_hash",
            "summary_prompt_version",
            "summary_error",
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

function isJobDue(job: AppAiSummaryJob, now: Date): boolean {
    if (job.status !== "pending") {
        return false;
    }
    if (!job.scheduled_at) {
        return true;
    }
    return new Date(job.scheduled_at).getTime() <= now.getTime();
}

function canOverwriteArticleSummary(article: AppArticle): boolean {
    const summary = String(article.summary || "").trim();
    return !summary || article.summary_source === "ai";
}

function isEncryptedMarkdown(bodyMarkdown: string): boolean {
    return String(bodyMarkdown || "")
        .trim()
        .startsWith("CL2:");
}

function isArticleEligibleForSummary(article: AppArticle): boolean {
    return (
        article.status === "published" &&
        article.ai_summary_enabled &&
        !isEncryptedMarkdown(article.body_markdown) &&
        canOverwriteArticleSummary(article)
    );
}

function computeArticleContentHash(article: AppArticle): string {
    return buildSummaryContentHash({
        title: article.title,
        bodyMarkdown: article.body_markdown,
    });
}

function isArticleStaleForJob(
    article: AppArticle,
    job: Pick<AppAiSummaryJob, "content_hash">,
): boolean {
    return computeArticleContentHash(article) !== job.content_hash;
}

function buildConditionalArticleUpdateFilter(article: AppArticle): JsonObject {
    return {
        _and: [
            { id: { _eq: article.id } },
            { status: { _eq: "published" } },
            { ai_summary_enabled: { _eq: true } },
            { title: { _eq: article.title } },
            { body_markdown: { _eq: article.body_markdown } },
        ],
    } as JsonObject;
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
        scheduled_at: null,
        leased_until: null,
        finished_at: now.toISOString(),
    });
    return { status: "skipped", jobId: job.id };
}

async function generateSummary(input: {
    article: AppArticle;
    targetLength: AppAiSummaryJob["target_length"];
    settings: DecryptedAiSettings;
    language: string;
    fetch?: typeof fetch;
}): Promise<{
    summary: string;
    inputChars: number;
    chunkCount: number;
    outputChars: number;
}> {
    const lengthConfig = resolveAiSummaryLengthConfig(input.targetLength);
    const chunks = splitMarkdownForSummary(input.article.body_markdown, {
        targetChars: lengthConfig.chunkMaxTokens * 8,
        maxChars: lengthConfig.chunkMaxTokens * 12,
    });
    const chunkSummaries: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
        const chunkSummary = await callOpenAICompatibleChatCompletion({
            fetch: input.fetch,
            baseUrl: input.settings.baseUrl,
            apiKey: input.settings.apiKey || "",
            model: input.settings.model,
            messages: buildChunkSummaryMessages({
                language: input.language,
                title: input.article.title,
                chunk: chunks[index] ?? "",
                chunkIndex: index,
                chunkCount: chunks.length,
                targetLength: input.targetLength,
            }),
            maxTokens: lengthConfig.chunkMaxTokens,
        });
        chunkSummaries.push(chunkSummary);
    }

    const rawSummary =
        chunkSummaries.length === 1
            ? (chunkSummaries[0] ?? "")
            : await callOpenAICompatibleChatCompletion({
                  fetch: input.fetch,
                  baseUrl: input.settings.baseUrl,
                  apiKey: input.settings.apiKey || "",
                  model: input.settings.model,
                  messages: buildFinalSummaryMessages({
                      language: input.language,
                      title: input.article.title,
                      chunkSummaries,
                      targetLength: input.targetLength,
                  }),
                  maxTokens: lengthConfig.finalMaxTokens,
              });
    const summary = normalizeAiSummaryText(rawSummary);
    if (!summary) {
        throw new AiSummaryError("PROVIDER_BAD_RESPONSE", "AI 摘要内容为空", {
            retryable: true,
        });
    }

    return {
        summary,
        inputChars: input.article.body_markdown.length,
        chunkCount: chunks.length,
        outputChars: summary.length,
    };
}

async function handleJobFailure(params: {
    job: AppAiSummaryJob;
    error: unknown;
    articleId: string | null;
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

    if (failed && params.articleId) {
        await updateOne("app_articles", params.articleId, {
            summary_error: classified.message,
        });
    }

    return {
        status: failed ? "failed" : "pending",
        jobId: params.job.id,
    };
}

export async function runAiSummaryJob(
    input: RunAiSummaryJobInput,
): Promise<RunAiSummaryJobResult> {
    const now = input.now ?? new Date();
    const lock = await acquireAiSummaryJobLock(input.jobId);
    if (!lock) {
        return { status: "pending", jobId: input.jobId };
    }

    let currentArticleId: string | null = null;
    let claimedJob: AppAiSummaryJob | null = null;

    try {
        const job = await readJob(input.jobId);
        if (!job) {
            return { status: "skipped", jobId: input.jobId };
        }
        if (!isJobDue(job, now)) {
            return { status: "skipped", jobId: job.id };
        }
        claimedJob = job;
        currentArticleId = job.article_id;

        await updateOne("app_ai_summary_jobs", job.id, {
            status: "processing",
            attempts: job.attempts + 1,
            started_at: now.toISOString(),
            leased_until: new Date(
                now.getTime() + readAiSummaryJobLeaseSeconds() * 1_000,
            ).toISOString(),
        });

        if (!canRun(input.settings)) {
            return await markJobSkipped(job, "config_missing", now);
        }
        const article = await readArticle(job.article_id);
        if (!article) {
            return await markJobSkipped(job, "article_not_found", now);
        }
        currentArticleId = article.id;
        const siteSettings = await getResolvedSiteSettings();
        const promptVersion = resolveAiSummaryPromptVersion(
            siteSettings.system.lang,
        );
        if (!isArticleEligibleForSummary(article)) {
            return await markJobSkipped(job, "article_not_eligible", now);
        }
        if (isArticleStaleForJob(article, job)) {
            return await markJobSkipped(job, "article_content_stale", now);
        }

        const generated = await generateSummary({
            article,
            targetLength: job.target_length,
            settings: input.settings,
            language: siteSettings.system.lang,
            fetch: input.fetch,
        });
        const freshArticle = await readArticle(article.id);
        if (!freshArticle) {
            return await markJobSkipped(job, "article_not_found", now);
        }
        if (
            isArticleStaleForJob(freshArticle, job) ||
            !isArticleEligibleForSummary(freshArticle)
        ) {
            return await markJobSkipped(job, "article_content_stale", now);
        }
        const freshContentHash = computeArticleContentHash(freshArticle);

        const updatedArticles = await updateMany(
            "app_articles",
            {
                filter: buildConditionalArticleUpdateFilter(freshArticle),
                limit: 1,
            },
            {
                summary: generated.summary,
                summary_source: "ai",
                summary_generated_at: now.toISOString(),
                summary_model: input.settings.model,
                summary_prompt_version: promptVersion,
                summary_content_hash: freshContentHash,
                summary_error: null,
            },
            {
                fields: ["id"],
            },
        );
        if (updatedArticles.length === 0) {
            return await markJobSkipped(job, "article_content_stale", now);
        }
        await updateOne("app_ai_summary_jobs", job.id, {
            status: "succeeded",
            scheduled_at: null,
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
        if (!claimedJob) {
            throw error;
        }
        return await handleJobFailure({
            job: claimedJob,
            error,
            articleId: currentArticleId,
            now,
        });
    } finally {
        await releaseAiSummaryJobLock(lock);
    }
}
