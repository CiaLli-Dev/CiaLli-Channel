import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    readMany: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn(),
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

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/redis/client", () => ({
    getRedisClient: vi.fn(() => ({
        set: vi.fn(async () => "OK"),
        delIfValue: vi.fn(async () => true),
    })),
}));

import {
    createOne,
    readMany,
    updateMany,
    updateOne,
} from "@/server/directus/client";
import { DEFAULT_SITE_THEME_PRESET } from "@/config/theme-presets";
import {
    buildPublicAiSettings,
    loadDecryptedAiSettings,
    loadStoredAiSettings,
    resolveStoredAiSettings,
    saveAiSettingsPatch,
    serializeAiSettingsPatch,
} from "@/server/ai-summary/config";
import { buildSummaryContentHash } from "@/server/ai-summary/hash";
import { enqueueArticleSummaryJob } from "@/server/ai-summary/jobs";
import { resolveAiSummaryPromptVersion } from "@/server/ai-summary/prompts";
import { runAiSummaryJob } from "@/server/ai-summary/runner";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { getResolvedSiteSettings } from "@/server/site-settings/service";
import type { ResolvedSiteSettings } from "@/types/site-settings";

const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedUpdateMany = vi.mocked(updateMany);
const mockedGetResolvedSiteSettings = vi.mocked(getResolvedSiteSettings);
const mockedWithServiceRepositoryContext = vi.mocked(
    withServiceRepositoryContext,
);

function createResolvedSiteSettings(
    language: "en" | "zh_CN" | "zh_TW" | "ja",
): ResolvedSiteSettings {
    return {
        system: {
            siteURL: "https://example.com/",
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
                themePreset: DEFAULT_SITE_THEME_PRESET,
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

    it("loads stored settings through service repository context", async () => {
        mockedReadMany.mockResolvedValue([
            {
                id: "settings-1",
                settings_other: {
                    ai: {
                        enabled: true,
                        articleSummaryEnabled: true,
                        baseUrl: "https://api.example.com/v1",
                        model: "test-model",
                    },
                },
            },
        ] as never);

        const result = await loadStoredAiSettings();

        expect(result).toMatchObject({
            enabled: true,
            articleSummaryEnabled: true,
            baseUrl: "https://api.example.com/v1",
            model: "test-model",
        });
        expect(mockedWithServiceRepositoryContext).toHaveBeenCalled();
    });

    it("loads decrypted settings through service repository context", async () => {
        const stored = serializeAiSettingsPatch(
            { apiKey: "sk-secret" },
            resolveStoredAiSettings(null),
        );
        mockedReadMany.mockResolvedValue([
            {
                id: "settings-1",
                settings_other: {
                    ai: stored,
                },
            },
        ] as never);

        const result = await loadDecryptedAiSettings();

        expect(result.apiKey).toBe("sk-secret");
        expect(mockedWithServiceRepositoryContext).toHaveBeenCalled();
    });

    it("saves settings through service repository context", async () => {
        mockedReadMany.mockResolvedValue([
            {
                id: "settings-1",
                settings_other: {
                    ai: {
                        enabled: false,
                        articleSummaryEnabled: false,
                        baseUrl: "",
                        model: "",
                        apiKeyEncrypted: null,
                        updatedAt: null,
                    },
                },
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({ id: "settings-1" } as never);

        const result = await saveAiSettingsPatch({
            enabled: true,
            articleSummaryEnabled: true,
            baseUrl: "https://api.example.com/v1",
            model: "test-model",
        });

        expect(result).toMatchObject({
            enabled: true,
            articleSummaryEnabled: true,
            baseUrl: "https://api.example.com/v1",
            model: "test-model",
        });
        expect(mockedWithServiceRepositoryContext).toHaveBeenCalled();
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_site_settings",
            "settings-1",
            expect.objectContaining({
                settings_other: expect.objectContaining({
                    ai: expect.objectContaining({
                        enabled: true,
                        articleSummaryEnabled: true,
                    }),
                }),
            }),
        );
    });

    it("rejects unsafe production AI base URLs", () => {
        const originalNodeEnv = process.env.NODE_ENV;
        const originalPublicBaseUrl = process.env.APP_PUBLIC_BASE_URL;
        process.env.NODE_ENV = "production";
        process.env.APP_PUBLIC_BASE_URL = "https://cialli.example.com";

        expect(() =>
            serializeAiSettingsPatch(
                {
                    baseUrl: "http://localhost:11434/v1",
                },
                resolveStoredAiSettings(null),
            ),
        ).toThrow(/Base URL/u);

        process.env.NODE_ENV = originalNodeEnv;
        process.env.APP_PUBLIC_BASE_URL = originalPublicBaseUrl;
    });
});

describe("enqueueArticleSummaryJob", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUpdateMany.mockResolvedValue([{ id: "article-1" }] as never);
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
        expect(mockedWithServiceRepositoryContext).toHaveBeenCalled();
    });

    it("reads latest summary job through service repository context", async () => {
        mockedReadMany.mockResolvedValue([
            {
                id: "job-1",
                status: "pending",
                error_message: null,
                date_created: "2026-04-22T00:00:00.000Z",
                started_at: null,
                finished_at: null,
            },
        ] as never);

        const { readLatestArticleSummaryJob } =
            await import("@/server/ai-summary/jobs");
        const result = await readLatestArticleSummaryJob("article-1");

        expect(result).toMatchObject({
            id: "job-1",
            status: "pending",
        });
        expect(mockedWithServiceRepositoryContext).toHaveBeenCalled();
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
                    content_hash: buildSummaryContentHash({
                        title: "标题",
                        bodyMarkdown: "# 正文\n内容",
                    }),
                    prompt_version: "v1",
                    model: "test-model",
                    target_length: "medium",
                    scheduled_at: null,
                    leased_until: null,
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
        expect(mockedUpdateMany).toHaveBeenCalledWith(
            "app_articles",
            expect.objectContaining({
                filter: expect.any(Object),
                limit: 1,
            }),
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
                    content_hash: buildSummaryContentHash({
                        title: "Release notes",
                        bodyMarkdown: "# Update\nBody",
                    }),
                    prompt_version: resolveAiSummaryPromptVersion("zh_CN"),
                    model: "test-model",
                    target_length: "medium",
                    scheduled_at: null,
                    leased_until: null,
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
        expect(mockedUpdateMany).toHaveBeenCalledWith(
            "app_articles",
            expect.objectContaining({
                filter: expect.any(Object),
            }),
            expect.objectContaining({
                summary_prompt_version: resolveAiSummaryPromptVersion("en"),
            }),
            expect.any(Object),
        );
    });

    it("skips stale jobs before calling the provider when content hash changed", async () => {
        mockedReadMany
            .mockResolvedValueOnce([
                {
                    id: "job-1",
                    article_id: "article-1",
                    status: "pending",
                    attempts: 0,
                    max_attempts: 3,
                    content_hash: "stale-hash",
                    prompt_version: "v1",
                    model: "test-model",
                    target_length: "medium",
                    scheduled_at: null,
                    leased_until: null,
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
        const fetchMock = vi.fn();

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

        expect(result.status).toBe("skipped");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_ai_summary_jobs",
            "job-1",
            expect.objectContaining({
                status: "skipped",
                leased_until: null,
                finished_at: expect.any(String),
            }),
        );
    });

    it("writes article summary_error after terminal failures", async () => {
        mockedReadMany
            .mockResolvedValueOnce([
                {
                    id: "job-1",
                    article_id: "article-1",
                    status: "pending",
                    attempts: 2,
                    max_attempts: 3,
                    content_hash: buildSummaryContentHash({
                        title: "标题",
                        bodyMarkdown: "# 正文\n内容",
                    }),
                    prompt_version: "v1",
                    model: "test-model",
                    target_length: "medium",
                    scheduled_at: null,
                    leased_until: null,
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

        const result = await runAiSummaryJob({
            jobId: "job-1",
            settings: {
                enabled: true,
                articleSummaryEnabled: true,
                baseUrl: "https://api.example.com/v1",
                model: "test-model",
                apiKey: "sk-secret",
            },
            fetch: vi.fn().mockRejectedValue(new Error("provider exploded")),
        });

        expect(result.status).toBe("failed");
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_articles",
            "article-1",
            expect.objectContaining({
                summary_error: "provider exploded",
            }),
        );
    });
});
