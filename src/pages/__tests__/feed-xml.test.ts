import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";
import type { SiteFeedBuildResult } from "@/server/application/feed/site-feed.service";

const { buildSiteFeedMock, rssMock } = vi.hoisted(() => ({
    buildSiteFeedMock: vi.fn<() => Promise<SiteFeedBuildResult>>(),
    rssMock: vi.fn(),
}));

vi.mock("@/server/application/feed/site-feed.service", () => ({
    buildSiteFeed: buildSiteFeedMock,
}));

vi.mock("@astrojs/rss", () => ({
    default: rssMock,
}));

function makeContext(url: string): APIContext {
    const context = createMockAPIContext({ url });
    return {
        ...context,
        site: new URL("https://example.com/"),
        locals: {},
    } as unknown as APIContext;
}

function createFeedBuildResult(): SiteFeedBuildResult {
    return {
        title: "CiaLli Channel",
        description: "社区订阅源",
        language: "zh_CN",
        updated: "2026-04-17T08:00:00.000Z",
        entries: [
            {
                title: "第一篇文章",
                summary: "文章摘要",
                link: "/posts/post-1",
                content: "<p>正文 HTML</p>",
                published: new Date("2026-04-16T08:00:00.000Z"),
                updated: new Date("2026-04-16T09:00:00.000Z"),
                authorName: "作者甲",
                category: "tech",
            },
        ],
    };
}

afterEach(() => {
    buildSiteFeedMock.mockReset();
    rssMock.mockReset();
    vi.resetModules();
});

describe("feed xml routes", () => {
    it("rss.xml 会把共享 feed 结果映射为 RSS items", async () => {
        buildSiteFeedMock.mockResolvedValue(createFeedBuildResult());
        rssMock.mockImplementation(() => {
            return new Response("rss-ok", {
                headers: {
                    "Content-Type": "application/rss+xml; charset=utf-8",
                },
            });
        });

        const { GET } = await import("@/pages/rss.xml");
        const response = await GET(makeContext("https://example.com/rss.xml"));

        expect(buildSiteFeedMock).toHaveBeenCalledTimes(1);
        expect(rssMock).toHaveBeenCalledWith({
            title: "CiaLli Channel",
            description: "社区订阅源",
            site: new URL("https://example.com/"),
            items: [
                {
                    title: "第一篇文章",
                    description: "文章摘要",
                    pubDate: new Date("2026-04-16T08:00:00.000Z"),
                    link: "/posts/post-1",
                    content: "<p>正文 HTML</p>",
                },
            ],
            customData: "<language>zh_CN</language>",
        });
        expect(await response.text()).toBe("rss-ok");
    });

    it("atom.xml 会保留 Atom 专属字段与 CDATA 内容", async () => {
        buildSiteFeedMock.mockResolvedValue(createFeedBuildResult());

        const { GET } = await import("@/pages/atom.xml");
        const response = await GET(makeContext("https://example.com/atom.xml"));
        const text = await response.text();

        expect(buildSiteFeedMock).toHaveBeenCalledTimes(1);
        expect(response.headers.get("Content-Type")).toBe(
            "application/atom+xml; charset=utf-8",
        );
        expect(text).toContain("<title>第一篇文章</title>");
        expect(text).toContain("<summary>文章摘要</summary>");
        expect(text).toContain("<![CDATA[<p>正文 HTML</p>]]>");
        expect(text).toContain("<name>作者甲</name>");
        expect(text).toContain('<category term="tech"></category>');
        expect(text).toContain(
            '<link href="https://example.com/posts/post-1" rel="alternate" type="text/html"/>',
        );
    });
});
