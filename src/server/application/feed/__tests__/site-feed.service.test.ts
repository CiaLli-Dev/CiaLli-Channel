import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultSiteSettings, systemSiteConfig } from "@/config";
import {
    buildSiteFeed,
    listSiteFeedPreviewEntries,
} from "@/server/application/feed/site-feed.service";
import type { ResolvedSiteSettings } from "@/types/site-settings";

const {
    readManyMock,
    getAuthorBundleMock,
    renderMarkdownMock,
    getResolvedSiteSettingsMock,
} = vi.hoisted(() => ({
    readManyMock: vi.fn(),
    getAuthorBundleMock: vi.fn(),
    renderMarkdownMock: vi.fn(),
    getResolvedSiteSettingsMock: vi.fn<() => Promise<ResolvedSiteSettings>>(),
}));

vi.mock("@/server/directus/client", () => ({
    readMany: readManyMock,
    runWithDirectusServiceAccess: async <T>(task: () => Promise<T>) =>
        await task(),
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: getAuthorBundleMock,
}));

vi.mock("@/utils/content-post-helpers", async () => {
    const actual = await vi.importActual<
        typeof import("@/utils/content-post-helpers")
    >("@/utils/content-post-helpers");
    return actual;
});

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

function createArticleRow(params: {
    id: string;
    title: string;
    body: string;
    summary?: string;
    encrypted?: boolean;
    category?: string;
    shortId?: string;
}) {
    return {
        id: params.id,
        short_id: params.shortId ?? params.id,
        author_id: `author-${params.id}`,
        title: params.title,
        slug: params.id,
        summary: params.summary ?? `摘要-${params.id}`,
        body_markdown: params.encrypted ? `CL2:${params.body}` : params.body,
        category: params.category,
        status: "published",
        is_public: true,
        date_created: BASE_NOW.toISOString(),
        date_updated: new Date(BASE_NOW.getTime() + 60_000).toISOString(),
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
    readManyMock.mockReset();
    getAuthorBundleMock.mockReset();
    renderMarkdownMock.mockReset();
    getResolvedSiteSettingsMock.mockReset();
});

describe("buildSiteFeed", () => {
    it("feed service 通过轻量 readMany 链路读取文章并过滤加密正文", async () => {
        readManyMock.mockResolvedValue([
            createArticleRow({
                id: "visible-post",
                title: "可见文章",
                body: "visible-body",
                category: "tech",
            }),
            createArticleRow({
                id: "encrypted-post",
                title: "加密文章",
                body: "encrypted-body",
                encrypted: true,
            }),
        ]);
        getAuthorBundleMock.mockResolvedValue(
            new Map([
                [
                    "author-visible-post",
                    {
                        id: "author-visible-post",
                        name: "作者-visible-post",
                        display_name: "作者-visible-post",
                        username: "visible",
                    },
                ],
            ]),
        );
        renderMarkdownMock.mockResolvedValue("<p>rendered</p>");

        const result = await buildSiteFeed({
            site: new URL("https://example.com/"),
            resolvedSiteSettings: createResolvedSiteSettings(),
        });

        expect(readManyMock).toHaveBeenCalledTimes(1);
        expect(renderMarkdownMock).toHaveBeenCalledTimes(1);
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toMatchObject({
            title: "可见文章",
            summary: "摘要-visible-post",
            link: "/posts/visible-post",
            content: "<p>rendered</p>",
            authorName: "作者-visible-post",
            category: "tech",
        });
    });

    it("会过滤加密文章并透传站点元信息", async () => {
        readManyMock.mockResolvedValue([
            createArticleRow({
                id: "visible-post",
                title: "可见文章",
                body: "visible-body",
                category: "tech",
            }),
        ]);
        getAuthorBundleMock.mockResolvedValue(
            new Map([
                [
                    "author-visible-post",
                    {
                        id: "author-visible-post",
                        name: "作者-visible-post",
                        display_name: "作者-visible-post",
                        username: "visible",
                    },
                ],
            ]),
        );
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

        readManyMock.mockResolvedValue([
            createArticleRow({
                id: "first-post",
                title: "第一篇",
                body: "first-body",
            }),
            createArticleRow({
                id: "second-post",
                title: "第二篇",
                body: "second-body",
            }),
        ]);
        getAuthorBundleMock.mockResolvedValue(
            new Map([
                [
                    "author-first-post",
                    {
                        id: "author-first-post",
                        name: "作者-first-post",
                        display_name: "作者-first-post",
                        username: "first",
                    },
                ],
                [
                    "author-second-post",
                    {
                        id: "author-second-post",
                        name: "作者-second-post",
                        display_name: "作者-second-post",
                        username: "second",
                    },
                ],
            ]),
        );
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

        await vi.waitFor(() => {
            expect(renderMarkdownMock.mock.calls).toHaveLength(2);
        });
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
        readManyMock.mockResolvedValue([
            createArticleRow({
                id: "fallback-post",
                title: "回退配置文章",
                body: "fallback-body",
            }),
        ]);
        getAuthorBundleMock.mockResolvedValue(
            new Map([
                [
                    "author-fallback-post",
                    {
                        id: "author-fallback-post",
                        name: "作者-fallback-post",
                        display_name: "作者-fallback-post",
                        username: "fallback",
                    },
                ],
            ]),
        );
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

    it("listSiteFeedPreviewEntries 只返回最近可见 feed 项", async () => {
        readManyMock.mockResolvedValue([
            createArticleRow({
                id: "preview-1",
                title: "预览 1",
                body: "body-1",
            }),
            createArticleRow({
                id: "preview-2",
                title: "预览 2",
                body: "body-2",
                shortId: "short-2",
            }),
            createArticleRow({
                id: "preview-3",
                title: "预览 3",
                body: "body-3",
                encrypted: true,
            }),
        ]);
        getAuthorBundleMock.mockResolvedValue(new Map());

        const result = await listSiteFeedPreviewEntries(2);

        expect(result).toEqual([
            {
                id: "preview-1",
                summary: "摘要-preview-1",
                title: "预览 1",
                url: "/posts/preview-1",
                published: BASE_NOW,
            },
            {
                id: "short-2",
                summary: "摘要-preview-2",
                title: "预览 2",
                url: "/posts/short-2",
                published: BASE_NOW,
            },
        ]);
    });
});
