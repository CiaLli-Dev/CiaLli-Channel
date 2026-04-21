import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    readMany: vi.fn(),
    updateOne: vi.fn(),
}));

vi.mock("@/server/site-settings/service", () => ({
    getResolvedSiteSettings: vi.fn(),
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
import { buildSummaryContentHash } from "@/server/ai-summary/hash";
import { enqueueArticleSummaryJob } from "@/server/ai-summary/jobs";
import { resolveAiSummaryPromptVersion } from "@/server/ai-summary/prompts";
import { runAiSummaryJob } from "@/server/ai-summary/runner";
import { getResolvedSiteSettings } from "@/server/site-settings/service";
import type { ResolvedSiteSettings } from "@/types/site-settings";

const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedGetResolvedSiteSettings = vi.mocked(getResolvedSiteSettings);

function createResolvedSiteSettings(
    language: "en" | "zh_CN" | "zh_TW" | "ja",
): ResolvedSiteSettings {
    return {
        system: {
            siteURL: "https://www.ciallichannel.com/",
            lang: language,
            timeZone: "UTC",
            themeColor: { hue: 200 },
            pageScaling: { targetWidth: 2000 },
            expressiveCode: {
                theme: "github-dark",
                hideDuringThemeTransition: true,
            },
        },
        settings: {
            site: {
                title: "CiaLli",
                subtitle: "内容社区",
                lang: language,
                timeZone: null,
                themePreset: "blue",
                keywords: [],
                siteStartDate: "2026-02-01",
                favicon: [],
            },
            auth: { register_enabled: false },
            navbarTitle: {
                mode: "logo",
                text: "CiaLliUI",
                icon: "assets/home/home.png",
                logo: "assets/home/default-logo.png",
            },
            wallpaperMode: { defaultMode: "banner" },
            banner: {
                src: [],
                position: "center",
                carousel: { enable: true, interval: 5 },
                waves: { enable: true },
                homeText: {
                    enable: true,
                    title: "我的小屋",
                    subtitle: ["副标题"],
                    typewriter: {
                        enable: true,
                        speed: 100,
                        deleteSpeed: 50,
                        pauseTime: 2000,
                    },
                },
                navbar: { transparentMode: "semifull" },
            },
            toc: {
                enable: true,
                mode: "sidebar",
                depth: 2,
                useJapaneseBadge: false,
            },
            navBar: { links: [] },
            profile: { avatar: "assets/images/avatar.webp" },
            announcement: {
                title: "",
                summary: "",
                body_markdown: "",
                closable: true,
            },
            musicPlayer: {
                enable: false,
                meting_api: "",
                id: "",
                server: "",
                type: "",
                marqueeSpeed: 10,
            },
            ai: {
                enabled: true,
                articleSummaryEnabled: true,
                baseUrl: "https://api.example.com/v1",
                model: "test-model",
                apiKeyEncrypted: null,
                updatedAt: null,
            },
        },
    };
}

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
        mockedGetResolvedSiteSettings.mockResolvedValue(
            createResolvedSiteSettings("zh_CN") as never,
        );
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
                prompt_version: resolveAiSummaryPromptVersion("zh_CN"),
            }),
            expect.any(Object),
        );
    });

    it("uses the current site language when creating a job", async () => {
        mockedGetResolvedSiteSettings.mockResolvedValue(
            createResolvedSiteSettings("en") as never,
        );
        mockedReadMany
            .mockResolvedValueOnce([
                {
                    id: "article-1",
                    author_id: "author-1",
                    status: "published",
                    ai_summary_enabled: true,
                    title: "Title",
                    summary: null,
                    summary_source: "none",
                    body_markdown: "# Body",
                },
            ] as never)
            .mockResolvedValueOnce([]);
        mockedCreateOne.mockResolvedValue({ id: "job-1" } as never);

        await enqueueArticleSummaryJob({
            articleId: "article-1",
            settings: {
                enabled: true,
                articleSummaryEnabled: true,
                baseUrl: "https://api.example.com/v1",
                model: "test-model",
                apiKey: "sk-secret",
            },
        });

        expect(mockedCreateOne).toHaveBeenCalledWith(
            "app_ai_summary_jobs",
            expect.objectContaining({
                prompt_version: resolveAiSummaryPromptVersion("en"),
            }),
            expect.any(Object),
        );
    });

    it("re-enqueues when the article summary was generated for another site language", async () => {
        mockedGetResolvedSiteSettings.mockResolvedValue(
            createResolvedSiteSettings("en") as never,
        );
        const contentHash = buildSummaryContentHash({
            title: "Title",
            bodyMarkdown: "# Body",
        });
        mockedReadMany
            .mockResolvedValueOnce([
                {
                    id: "article-1",
                    author_id: "author-1",
                    status: "published",
                    ai_summary_enabled: true,
                    title: "Title",
                    summary: "旧摘要",
                    summary_source: "ai",
                    summary_content_hash: contentHash,
                    summary_prompt_version:
                        resolveAiSummaryPromptVersion("zh_CN"),
                    body_markdown: "# Body",
                },
            ] as never)
            .mockResolvedValueOnce([]);
        mockedCreateOne.mockResolvedValue({ id: "job-2" } as never);

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

        expect(result).toEqual({ jobId: "job-2", status: "pending" });
        expect(mockedCreateOne).toHaveBeenCalledTimes(1);
    });
});

describe("runAiSummaryJob", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedGetResolvedSiteSettings.mockResolvedValue(
            createResolvedSiteSettings("zh_CN") as never,
        );
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
                summary_prompt_version: resolveAiSummaryPromptVersion("zh_CN"),
                summary_error: null,
            }),
            expect.any(Object),
        );
    });

    it("uses the current site language for prompts and stored prompt version", async () => {
        mockedGetResolvedSiteSettings.mockResolvedValue(
            createResolvedSiteSettings("en") as never,
        );
        mockedReadMany
            .mockResolvedValueOnce([
                {
                    id: "job-1",
                    article_id: "article-1",
                    status: "pending",
                    attempts: 0,
                    max_attempts: 3,
                    content_hash: "old",
                    prompt_version: resolveAiSummaryPromptVersion("zh_CN"),
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
                    title: "Release notes",
                    summary: null,
                    summary_source: "none",
                    body_markdown: "# Update\nBody",
                },
            ] as never);
        mockedUpdateOne.mockResolvedValue({ id: "updated" } as never);
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        { message: { content: "This is the AI summary." } },
                    ],
                }),
                { status: 200 },
            ),
        );

        const result = await runAiSummaryJob({
            jobId: "job-1",
            settings: {
                enabled: true,
                articleSummaryEnabled: true,
                baseUrl: "https://api.example.com/v1",
                model: "test-model",
                apiKey: "sk-secret",
            },
            fetch: fetchMock,
        });

        expect(result.status).toBe("succeeded");
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.example.com/v1/chat/completions",
            expect.objectContaining({
                body: expect.stringContaining("site's language setting"),
            }),
        );
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_articles",
            "article-1",
            expect.objectContaining({
                summary_prompt_version: resolveAiSummaryPromptVersion("en"),
            }),
            expect.any(Object),
        );
    });
});
