import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultSiteSettings, systemSiteConfig } from "@/config";
import { buildSiteFeed } from "@/server/application/feed/site-feed.service";
import type { ResolvedSiteSettings } from "@/types/site-settings";
import type { DirectusPostEntry } from "@/utils/content-utils";

const { getSortedPostsMock, renderMarkdownMock, getResolvedSiteSettingsMock } =
    vi.hoisted(() => ({
        getSortedPostsMock: vi.fn<() => Promise<DirectusPostEntry[]>>(),
        renderMarkdownMock: vi.fn(),
        getResolvedSiteSettingsMock:
            vi.fn<() => Promise<ResolvedSiteSettings>>(),
    }));

vi.mock("@/utils/content-utils", () => ({
    getSortedPosts: getSortedPostsMock,
}));

vi.mock("@/server/markdown/render", () => ({
    renderMarkdown: renderMarkdownMock,
}));

vi.mock("@/server/site-settings/service", () => ({
    getResolvedSiteSettings: getResolvedSiteSettingsMock,
}));

const BASE_NOW = new Date("2026-04-17T08:00:00.000Z");

function createResolvedSiteSettings(): ResolvedSiteSettings {
    return {
        settings: {
            ...structuredClone(defaultSiteSettings),
            site: {
                ...structuredClone(defaultSiteSettings.site),
                title: "CiaLli Channel",
                subtitle: "社区订阅源",
            },
        },
        system: {
            ...structuredClone(systemSiteConfig),
            siteURL: "https://example.com",
            lang: "zh_CN",
            timeZone: "Asia/Shanghai",
        },
    };
}

function createPostEntry(params: {
    id: string;
    title: string;
    body: string;
    encrypted?: boolean;
    category?: string;
}): DirectusPostEntry {
    return {
        id: params.id,
        slug: params.id,
        body: params.body,
        url: `/posts/${params.id}`,
        data: {
            article_id: params.id,
            author_id: `author-${params.id}`,
            author: {
                id: `author-${params.id}`,
                name: `作者-${params.id}`,
            },
            title: params.title,
            description: `摘要-${params.id}`,
            image: undefined,
            tags: [],
            category: params.category,
            comment_count: 0,
            like_count: 0,
            published: BASE_NOW,
            updated: new Date(BASE_NOW.getTime() + 60_000),
            encrypted: params.encrypted ?? false,
        },
    };
}

function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

afterEach(() => {
    getSortedPostsMock.mockReset();
    renderMarkdownMock.mockReset();
    getResolvedSiteSettingsMock.mockReset();
});

describe("buildSiteFeed", () => {
    it("会过滤加密文章并透传站点元信息", async () => {
        getSortedPostsMock.mockResolvedValue([
            createPostEntry({
                id: "visible-post",
                title: "可见文章",
                body: "visible-body",
                category: "tech",
            }),
            createPostEntry({
                id: "encrypted-post",
                title: "加密文章",
                body: "encrypted-body",
                encrypted: true,
            }),
        ]);
        renderMarkdownMock.mockResolvedValue("<p>rendered</p>");

        const result = await buildSiteFeed({
            site: new URL("https://example.com/"),
            resolvedSiteSettings: createResolvedSiteSettings(),
        });

        expect(renderMarkdownMock).toHaveBeenCalledTimes(1);
        expect(result.title).toBe("CiaLli Channel");
        expect(result.description).toBe("社区订阅源");
        expect(result.language).toBe("zh_CN");
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toMatchObject({
            title: "可见文章",
            summary: "摘要-visible-post",
            link: "/posts/visible-post",
            content: "<p>rendered</p>",
            authorName: "作者-visible-post",
            category: "tech",
        });
        expect(result.updated).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
    });

    it("会并发渲染 Markdown 且保持原始排序", async () => {
        const first = createDeferred<string>();
        const second = createDeferred<string>();

        getSortedPostsMock.mockResolvedValue([
            createPostEntry({
                id: "first-post",
                title: "第一篇",
                body: "first-body",
            }),
            createPostEntry({
                id: "second-post",
                title: "第二篇",
                body: "second-body",
            }),
        ]);
        renderMarkdownMock.mockImplementation(async (source: string) => {
            if (source === "first-body") {
                return await first.promise;
            }
            return await second.promise;
        });

        const resultPromise = buildSiteFeed({
            site: new URL("https://example.com/"),
            resolvedSiteSettings: createResolvedSiteSettings(),
        });

        await Promise.resolve();

        expect(renderMarkdownMock.mock.calls).toHaveLength(2);
        expect(renderMarkdownMock.mock.calls.map(([source]) => source)).toEqual(
            ["first-body", "second-body"],
        );

        second.resolve("<p>second</p>");
        first.resolve("<p>first</p>");

        const result = await resultPromise;

        expect(result.entries.map((entry) => entry.title)).toEqual([
            "第一篇",
            "第二篇",
        ]);
        expect(result.entries.map((entry) => entry.content)).toEqual([
            "<p>first</p>",
            "<p>second</p>",
        ]);
    });

    it("未传入站点设置时会回退读取统一配置", async () => {
        getSortedPostsMock.mockResolvedValue([
            createPostEntry({
                id: "fallback-post",
                title: "回退配置文章",
                body: "fallback-body",
            }),
        ]);
        renderMarkdownMock.mockResolvedValue("<p>fallback</p>");
        getResolvedSiteSettingsMock.mockResolvedValue(
            createResolvedSiteSettings(),
        );

        const result = await buildSiteFeed({
            site: new URL("https://example.com/"),
        });

        expect(getResolvedSiteSettingsMock).toHaveBeenCalledTimes(1);
        expect(result.title).toBe("CiaLli Channel");
        expect(result.entries).toHaveLength(1);
    });
});
