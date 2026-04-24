import "dotenv/config";

import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";

import { readFileGcIntervalMs, runFileGcBatch } from "@/server/files/file-gc";
import { loadDecryptedAiSettings } from "@/server/ai-summary/config";
import {
    recoverStuckSummaryJobs,
    readAiSummaryJobBatchSize,
    readPendingSummaryJobs,
} from "@/server/ai-summary/jobs";
import { verifyInternalSecretHeader } from "@/server/ai-summary/internal-auth";
import { runAiSummaryJob } from "@/server/ai-summary/runner";
import type { RunAiSummaryJobResult } from "@/server/ai-summary/runner";
import { runWithDirectusServiceAccess } from "@/server/directus/client";
import { createNonOverlappingScheduler } from "@/worker/task-scheduler";

const DEFAULT_PORT = 4322;
const CONSUMER_INTERVAL_MS = 5_000;

let activeExecutions = 0;
const executionWaiters: Array<() => void> = [];

function readMaxConcurrency(): number {
    const raw = String(
        process.env.AI_SUMMARY_MAX_CONCURRENCY ||
            import.meta.env.AI_SUMMARY_MAX_CONCURRENCY ||
            "",
    ).trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 3;
    }
    return Math.floor(parsed);
}

async function withExecutionSlot<T>(task: () => Promise<T>): Promise<T> {
    while (activeExecutions >= readMaxConcurrency()) {
        await new Promise<void>((resolve) => {
            executionWaiters.push(resolve);
        });
    }

    activeExecutions += 1;
    try {
        return await task();
    } finally {
        activeExecutions = Math.max(0, activeExecutions - 1);
        const next = executionWaiters.shift();
        if (next) {
            next();
        }
    }
}

function sendJson(
    response: ServerResponse,
    status: number,
    payload: Record<string, unknown>,
): void {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
}

function headersFromRequest(request: IncomingMessage): Headers {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) {
            headers.set(key, value.join(","));
        } else if (value !== undefined) {
            headers.set(key, value);
        }
    }
    return headers;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    return raw ? (JSON.parse(raw) as unknown) : {};
}

function readNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : fallback;
}

async function processJob(jobId: string): Promise<Record<string, unknown>> {
    return await runWithDirectusServiceAccess(async () => {
        const settings = await loadDecryptedAiSettings();
        return await withExecutionSlot(
            async () => await runAiSummaryJob({ jobId, settings }),
        );
    });
}

async function processDueJobs(limit: number): Promise<Record<string, unknown>> {
    return await runWithDirectusServiceAccess(async () => {
        const now = new Date();
        const jobIds = await readPendingSummaryJobs(limit, now);
        const settings = await loadDecryptedAiSettings();
        const results = await Promise.all(
            jobIds.map(
                async (jobId): Promise<RunAiSummaryJobResult> =>
                    await withExecutionSlot(
                        async () =>
                            await runAiSummaryJob({ jobId, settings, now }),
                    ),
            ),
        );
        return { processed: results.length, results };
    });
}

const aiSummaryScheduler = createNonOverlappingScheduler({
    task: async (trigger) => {
        const now = new Date();
        const recovered = await runWithDirectusServiceAccess(
            async () => await recoverStuckSummaryJobs(now),
        );
        const processed = await processDueJobs(readAiSummaryJobBatchSize());
        console.info("[ai-summary-worker] scheduler tick", {
            trigger,
            recovered,
            processed: processed.processed,
        });
    },
});

const fileGcScheduler = createNonOverlappingScheduler({
    task: async (trigger) => {
        const result = await runFileGcBatch();
        console.info("[file-gc-worker] scheduler tick", {
            trigger,
            scanned: result.scanned,
            referenced: result.referenced,
            deleted: result.deleted,
        });
    },
});

async function runAiSummarySchedulerTick(
    trigger: "startup" | "interval",
): Promise<void> {
    try {
        await aiSummaryScheduler.run(trigger);
    } catch (error) {
        console.error("[ai-summary-worker] scheduler tick failed", error);
    }
}

async function runFileGcSchedulerTick(
    trigger: "startup" | "interval",
): Promise<void> {
    try {
        await fileGcScheduler.run(trigger);
    } catch (error) {
        console.error("[file-gc-worker] scheduler tick failed", error);
    }
}

async function handleProcessJob(
    body: unknown,
    response: ServerResponse,
): Promise<void> {
    const jobId =
        body && typeof body === "object"
            ? String((body as { job_id?: unknown }).job_id || "").trim()
            : "";
    if (!jobId) {
        sendJson(response, 400, { ok: false, message: "missing job_id" });
        return;
    }
    sendJson(response, 200, { ok: true, ...(await processJob(jobId)) });
}

async function handleProcessDue(
    body: unknown,
    response: ServerResponse,
): Promise<void> {
    const limit =
        body && typeof body === "object"
            ? readNumber(
                  (body as { limit?: unknown }).limit,
                  readAiSummaryJobBatchSize(),
              )
            : readAiSummaryJobBatchSize();
    sendJson(response, 200, { ok: true, ...(await processDueJobs(limit)) });
}

async function handleRecoverStuck(response: ServerResponse): Promise<void> {
    const recovered = await runWithDirectusServiceAccess(
        async () => await recoverStuckSummaryJobs(),
    );
    sendJson(response, 200, { ok: true, recovered });
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
): Promise<void> {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { ok: true });
        return;
    }
    if (!verifyInternalSecretHeader(headersFromRequest(request))) {
        sendJson(response, 401, { ok: false, message: "unauthorized" });
        return;
    }
    const body = await readJsonBody(request);

    if (
        request.method === "POST" &&
        url.pathname === "/internal/ai-summary/process-job"
    ) {
        await handleProcessJob(body, response);
        return;
    }

    if (
        request.method === "POST" &&
        url.pathname === "/internal/ai-summary/process-due"
    ) {
        await handleProcessDue(body, response);
        return;
    }

    if (
        request.method === "POST" &&
        url.pathname === "/internal/ai-summary/recover-stuck"
    ) {
        await handleRecoverStuck(response);
        return;
    }

    sendJson(response, 404, { ok: false, message: "not found" });
}

const port = DEFAULT_PORT;
createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
        console.error("[ai-summary-worker] request failed", error);
        sendJson(response, 500, { ok: false, message: "internal error" });
    });
}).listen(port, () => {
    console.info(`[ai-summary-worker] listening on ${port}`);
    void runAiSummarySchedulerTick("startup");
    void runFileGcSchedulerTick("startup");
    setInterval(() => {
        void runAiSummarySchedulerTick("interval");
    }, CONSUMER_INTERVAL_MS);
    setInterval(() => {
        void runFileGcSchedulerTick("interval");
    }, readFileGcIntervalMs());
});
