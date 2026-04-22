import type { AiSummaryJobKind, AiSummaryTargetLength } from "@/types/app";
import { loadDecryptedAiSettings } from "@/server/ai-summary/config";
import { AI_SUMMARY_INTERNAL_SECRET_HEADER } from "@/server/ai-summary/internal-auth";

import { enqueueArticleSummaryJob, type EnqueueSummaryJobResult } from "./jobs";

const WORKER_PORT = "4322";

function readAiSummaryInternalSecret(): string {
    return (
        String(process.env.AI_SUMMARY_INTERNAL_SECRET || "").trim() ||
        String(import.meta.env.AI_SUMMARY_INTERNAL_SECRET || "").trim()
    );
}

function resolveAiSummaryWorkerOrigin(): string {
    const directusUrl = String(
        process.env.DIRECTUS_URL || import.meta.env.DIRECTUS_URL || "",
    ).trim();
    const directusHostname = (() => {
        try {
            return new URL(directusUrl).hostname.toLowerCase();
        } catch {
            return "";
        }
    })();

    // Docker Compose 内部互联时直接走 worker 服务名；本机联调才回退到 localhost。
    if (
        process.env.NODE_ENV === "production" ||
        directusHostname === "directus"
    ) {
        return `http://worker:${WORKER_PORT}`;
    }
    return `http://127.0.0.1:${WORKER_PORT}`;
}

async function requestAiSummaryJobProcessing(jobId: string): Promise<void> {
    const internalSecret = readAiSummaryInternalSecret();
    if (!internalSecret) {
        console.warn(
            "[ai-summary] skipped worker trigger because secret is missing",
        );
        return;
    }

    const response = await fetch(
        `${resolveAiSummaryWorkerOrigin()}/internal/ai-summary/process-job`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                [AI_SUMMARY_INTERNAL_SECRET_HEADER]: internalSecret,
            },
            body: JSON.stringify({ job_id: jobId }),
            signal: AbortSignal.timeout(15_000),
        },
    );

    if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
            `[ai-summary] worker trigger failed (${response.status}): ${bodyText}`,
        );
    }
}

export async function enqueueAndTriggerArticleSummaryJob(input: {
    articleId: string;
    kind?: AiSummaryJobKind;
    force?: boolean;
    targetLength?: AiSummaryTargetLength;
}): Promise<EnqueueSummaryJobResult> {
    const result = await enqueueArticleSummaryJob({
        articleId: input.articleId,
        settings: await loadDecryptedAiSettings(),
        kind: input.kind,
        force: input.force,
        targetLength: input.targetLength,
    });

    if (result.jobId) {
        // 摘要生成保持异步，不阻塞文章发布成功返回；但会立刻唤醒 worker 开始处理。
        queueMicrotask(() => {
            void requestAiSummaryJobProcessing(result.jobId as string).catch(
                (error: unknown) => {
                    console.error(
                        "[ai-summary] failed to trigger worker job processing",
                        error,
                    );
                },
            );
        });
    }

    return result;
}
