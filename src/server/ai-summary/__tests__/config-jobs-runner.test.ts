import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    readMany: vi.fn(),
    updateOne: vi.fn(),
}));

vi.mock("@/server/cache/invalidation", () => ({
    awaitCacheInvalidations: vi.fn(async (tasks: Array<Promise<void>>) => {
        await Promise.all(tasks);
    }),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        invalidate: vi.fn(),
        invalidateByDomain: vi.fn(),
    },
}));

import { createOne, readMany, updateOne } from "@/server/directus/client";
import {
    buildPublicAiSettings,
    resolveStoredAiSettings,
    serializeAiSettingsPatch,
} from "@/server/ai-summary/config";
import { enqueueArticleSummaryJob } from "@/server/ai-summary/jobs";
import { runAiSummaryJob } from "@/server/ai-summary/runner";

const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);

describe("AI summary config", () => {
    it("stores API key encrypted and exposes only configured state", () => {
        const serialized = serializeAiSettingsPatch(
            {
                enabled: true,
                articleSummaryEnabled: true,
                baseUrl: "https://api.example.com/v1",
                model: "test-model",
                apiKey: "sk-secret",
            },
            resolveStoredAiSettings(null),
        );

        expect(serialized.apiKeyEncrypted).toMatch(/^v1:/u);
        expect(serialized.apiKeyEncrypted).not.toContain("sk-secret");
        expect(buildPublicAiSettings(serialized)).toEqual({
            enabled: true,
            articleSummaryEnabled: true,
            baseUrl: "https://api.example.com/v1",
            model: "test-model",
            apiKeyConfigured: true,
            updatedAt: expect.any(String),
        });
    });
});

describe("enqueueArticleSummaryJob", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("skips articles with manual summaries", async () => {
        mockedReadMany.mockResolvedValueOnce([
            {
                id: "article-1",
                author_id: "author-1",
                status: "published",
                ai_summary_enabled: true,
                title: "标题",
                summary: "作者手写摘要",
                summary_source: "manual",
                body_markdown: "# 正文",
            },
        ] as never);

        const result = await enqueueArticleSummaryJob({
            articleId: "article-1",
            settings: {
                enabled: true,
                articleSummaryEnabled: true,
                baseUrl: "https://api.example.com/v1",
                model: "test-model",
                apiKey: "sk-secret",
            },
        });

        expect(result.status).toBe("skipped");
        expect(mockedCreateOne).not.toHaveBeenCalled();
    });

    it("creates a deduplicated pending job when article is eligible", async () => {
        mockedReadMany
            .mockResolvedValueOnce([
                {
                    id: "article-1",
                    author_id: "author-1",
                    status: "published",
                    ai_summary_enabled: true,
                    title: "标题",
                    summary: null,
                    summary_source: "none",
                    body_markdown: "# 正文",
                },
            ] as never)
            .mockResolvedValueOnce([]);
        mockedCreateOne.mockResolvedValue({ id: "job-1" } as never);

        const result = await enqueueArticleSummaryJob({
            articleId: "article-1",
            settings: {
                enabled: true,
                articleSummaryEnabled: true,
                baseUrl: "https://api.example.com/v1",
                model: "test-model",
                apiKey: "sk-secret",
            },
        });

        expect(result).toEqual({ jobId: "job-1", status: "pending" });
        expect(mockedCreateOne).toHaveBeenCalledWith(
            "app_ai_summary_jobs",
            expect.objectContaining({
                article_id: "article-1",
                author_id: "author-1",
                status: "pending",
                provider: "openai-compatible",
                model: "test-model",
            }),
            expect.any(Object),
        );
    });
});

describe("runAiSummaryJob", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("generates and writes AI summary for an eligible job", async () => {
        mockedReadMany
            .mockResolvedValueOnce([
                {
                    id: "job-1",
                    article_id: "article-1",
                    status: "pending",
                    attempts: 0,
                    max_attempts: 3,
                    content_hash: "old",
                    prompt_version: "v1",
                    model: "test-model",
                    target_length: "medium",
                },
            ] as never)
            .mockResolvedValueOnce([
                {
                    id: "article-1",
                    author_id: "author-1",
                    status: "published",
                    ai_summary_enabled: true,
                    title: "标题",
                    summary: null,
                    summary_source: "none",
                    body_markdown: "# 正文\n内容",
                },
            ] as never);
        mockedUpdateOne.mockResolvedValue({ id: "updated" } as never);

        const result = await runAiSummaryJob({
            jobId: "job-1",
            settings: {
                enabled: true,
                articleSummaryEnabled: true,
                baseUrl: "https://api.example.com/v1",
                model: "test-model",
                apiKey: "sk-secret",
            },
            fetch: vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        choices: [{ message: { content: "这是 AI 摘要。" } }],
                    }),
                    { status: 200 },
                ),
            ),
        });

        expect(result.status).toBe("succeeded");
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_articles",
            "article-1",
            expect.objectContaining({
                summary: "这是 AI 摘要。",
                summary_source: "ai",
                summary_model: "test-model",
                summary_prompt_version: "v1",
                summary_error: null,
            }),
            expect.any(Object),
        );
    });
});
