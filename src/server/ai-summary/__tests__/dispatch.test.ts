import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai-summary/config", () => ({
    loadDecryptedAiSettings: vi.fn(async () => ({
        enabled: true,
        articleSummaryEnabled: true,
        baseUrl: "https://api.example.com/v1",
        model: "test-model",
        apiKey: "sk-secret",
    })),
}));

vi.mock("@/server/ai-summary/jobs", () => ({
    enqueueArticleSummaryJob: vi.fn(async () => ({
        jobId: "job-1",
        status: "pending",
    })),
}));

import { enqueueAndTriggerArticleSummaryJob } from "@/server/ai-summary/dispatch";

const originalEnv = {
    nodeEnv: process.env.NODE_ENV,
    directusUrl: process.env.DIRECTUS_URL,
    internalSecret: process.env.AI_SUMMARY_INTERNAL_SECRET,
};

afterEach(() => {
    process.env.NODE_ENV = originalEnv.nodeEnv;
    process.env.DIRECTUS_URL = originalEnv.directusUrl;
    process.env.AI_SUMMARY_INTERNAL_SECRET = originalEnv.internalSecret;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("enqueueAndTriggerArticleSummaryJob", () => {
    it("uses the worker service hostname inside local docker compose", async () => {
        process.env.NODE_ENV = "development";
        process.env.DIRECTUS_URL = "http://directus:8055";
        process.env.AI_SUMMARY_INTERNAL_SECRET = "local-secret";

        const fetchMock = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ ok: true }), { status: 200 }),
            );
        vi.stubGlobal("fetch", fetchMock);

        const result = await enqueueAndTriggerArticleSummaryJob({
            articleId: "article-1",
            kind: "on_publish",
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(result).toEqual({ jobId: "job-1", status: "pending" });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://worker:4322/internal/ai-summary/process-job",
            expect.objectContaining({
                method: "POST",
            }),
        );
    });
});
