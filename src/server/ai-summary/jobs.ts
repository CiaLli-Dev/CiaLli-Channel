import type {
    AiSummaryJobKind,
    AiSummaryTargetLength,
    AppAiSummaryJob,
    AppArticle,
} from "@/types/app";
import type { JsonObject } from "@/types/json";
import { createOne, readMany, updateOne } from "@/server/directus/client";

import { buildSummaryContentHash, buildSummaryJobDedupeKey } from "./hash";
import { AI_SUMMARY_PROMPT_VERSION } from "./prompts";
import type { DecryptedAiSettings } from "./config";

export type EnqueueSummaryJobResult = {
    jobId: string | null;
    status: "pending" | "skipped";
    reason?: string;
};

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
] as const;

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
            "ai_summary_enabled",
            "body_markdown",
        ],
    });
    return rows[0] ?? null;
}

async function readExistingJob(
    dedupeKey: string,
): Promise<AppAiSummaryJob | null> {
    const rows = await readMany("app_ai_summary_jobs", {
        filter: { dedupe_key: { _eq: dedupeKey } } as JsonObject,
        limit: 1,
        fields: [...SUMMARY_JOB_FIELDS],
    });
    return rows[0] ?? null;
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
    const contentHash = buildSummaryContentHash({
        title: article.title,
        bodyMarkdown: article.body_markdown,
    });
    if (
        !input.force &&
        article.summary_source === "ai" &&
        article.summary_content_hash === contentHash
    ) {
        return buildSkip("ai_summary_fresh");
    }

    const dedupeKey = buildSummaryJobDedupeKey({
        articleId: article.id,
        contentHash,
        promptVersion: AI_SUMMARY_PROMPT_VERSION,
        targetLength,
    });
    const existing = await readExistingJob(dedupeKey);
    if (existing) {
        return { jobId: existing.id, status: "pending" };
    }

    const created = await createOne(
        "app_ai_summary_jobs",
        {
            article_id: article.id,
            author_id: article.author_id,
            status: "pending",
            kind: input.kind ?? "on_publish",
            priority: input.kind === "manual" ? 10 : 0,
            dedupe_key: dedupeKey,
            content_hash: contentHash,
            prompt_version: AI_SUMMARY_PROMPT_VERSION,
            provider: "openai-compatible",
            model: input.settings.model,
            target_length: targetLength,
            attempts: 0,
            max_attempts: 3,
            scheduled_at: new Date().toISOString(),
        },
        { fields: ["id"] },
    );

    return { jobId: created.id, status: "pending" };
}

export async function readPendingSummaryJobs(limit: number): Promise<string[]> {
    const rows = await readMany("app_ai_summary_jobs", {
        filter: { status: { _eq: "pending" } } as JsonObject,
        sort: ["-priority", "scheduled_at"],
        limit,
        fields: ["id"],
    });
    return rows.map((row) => row.id);
}

export async function recoverStuckSummaryJobs(
    now = new Date(),
): Promise<number> {
    const rows = await readMany("app_ai_summary_jobs", {
        filter: {
            _and: [
                { status: { _eq: "processing" } },
                { leased_until: { _lt: now.toISOString() } },
            ],
        } as JsonObject,
        limit: 100,
        fields: ["id", "attempts", "max_attempts"],
    });

    await Promise.all(
        rows.map((job) =>
            updateOne("app_ai_summary_jobs", job.id, {
                status: job.attempts >= job.max_attempts ? "failed" : "pending",
                leased_until: null,
                scheduled_at: now.toISOString(),
            }),
        ),
    );
    return rows.length;
}
