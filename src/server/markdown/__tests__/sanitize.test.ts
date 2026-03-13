import { describe, expect, it } from "vitest";

import { sanitizeMarkdownHtml } from "@/server/markdown/sanitize";

describe("sanitizeMarkdownHtml 样式白名单", () => {
    it("过滤危险布局样式，保留安全文本样式", () => {
        const html = sanitizeMarkdownHtml(
            '<div style="position:fixed;z-index:99999;top:0;left:0;color:red">poc</div>',
        );

        expect(html).not.toContain("position:fixed");
        expect(html).not.toContain("z-index:99999");
        expect(html).not.toContain("top:0");
        expect(html).not.toContain("left:0");
        expect(html).toContain("color:red");
    });

    it("保留白名单内的排版样式", () => {
        const html = sanitizeMarkdownHtml(
            '<p style="font-size:16px;font-weight:700;text-align:center;text-decoration:underline;background-color:#fff">ok</p>',
        );

        expect(html).toContain("font-size:16px");
        expect(html).toContain("font-weight:700");
        expect(html).toContain("text-align:center");
        expect(html).toContain("text-decoration:underline");
        expect(html).toContain("background-color:#fff");
    });

    it("不可信源 iframe 使用严格 sandbox", () => {
        const html = sanitizeMarkdownHtml(
            '<iframe src="https://example.com/embed" sandbox="allow-scripts"></iframe>',
        );

        expect(html).toContain("<iframe");
        expect(html).toContain("sandbox");
        expect(html).not.toContain("allow-scripts");
    });

    it("可信源 iframe 获得必要的 sandbox 权限", () => {
        const sources = [
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD",
            "https://embed.music.apple.com/album/123456789",
            "https://www.notion.so/embeds/example",
            "https://uednd.notion.site/ebd/894a51c4c6c64a2f88c1e0f2deb0ba6c",
        ];
        for (const src of sources) {
            const html = sanitizeMarkdownHtml(`<iframe src="${src}"></iframe>`);
            expect(html).toContain(
                'sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"',
            );
        }
    });

    it("协议相对 URL 的可信源被补全为 https 并获得正确权限", () => {
        const html = sanitizeMarkdownHtml(
            '<iframe src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD"></iframe>',
        );
        expect(html).toContain(
            'sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"',
        );
        expect(html).toContain("player.bilibili.com");
    });

    it("notion.site 双斜杠路径会被规范化并保留可信 sandbox", () => {
        const html = sanitizeMarkdownHtml(
            '<iframe src="https://uednd.notion.site/ebd//894a51c4c6c64a2f88c1e0f2deb0ba6c"></iframe>',
        );
        expect(html).toContain(
            'src="https://uednd.notion.site/ebd/894a51c4c6c64a2f88c1e0f2deb0ba6c"',
        );
        expect(html).toContain(
            'sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"',
        );
    });

    it("iframe src 含首尾空白时仍可被规范化并命中可信源", () => {
        const html = sanitizeMarkdownHtml(
            '<iframe src="  https://uednd.notion.site/ebd/894a51c4c6c64a2f88c1e0f2deb0ba6c  "></iframe>',
        );
        expect(html).toContain(
            'src="https://uednd.notion.site/ebd/894a51c4c6c64a2f88c1e0f2deb0ba6c"',
        );
        expect(html).toContain(
            'sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"',
        );
    });

    it("无 src 的 iframe 使用严格 sandbox", () => {
        const html = sanitizeMarkdownHtml("<iframe></iframe>");
        expect(html).toContain("<iframe");
        expect(html).toContain("sandbox");
        expect(html).not.toContain("allow-scripts");
    });

    it("无效 src 的 iframe 使用严格 sandbox", () => {
        const html = sanitizeMarkdownHtml('<iframe src="not-a-url"></iframe>');
        expect(html).toContain("<iframe");
        expect(html).toContain("sandbox");
        expect(html).not.toContain("allow-scripts");
    });

    it("用户提供的 sandbox 属性会被覆盖为安全值", () => {
        const html = sanitizeMarkdownHtml(
            '<iframe src="https://www.youtube.com/embed/x" sandbox="allow-top-navigation allow-forms"></iframe>',
        );
        expect(html).toContain(
            'sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"',
        );
        expect(html).not.toContain("allow-top-navigation");
        expect(html).not.toContain("allow-forms");
    });

    it("移除 img 的 data URI 载荷", () => {
        const html = sanitizeMarkdownHtml(
            '<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+" alt="x" />',
        );

        expect(html).not.toContain("data:image/svg+xml");
        expect(html).toContain("<img");
    });

    it("绝对外链图片自动补 no-referrer", () => {
        const html = sanitizeMarkdownHtml(
            '<img src="https://example.com/image.png" alt="x" />',
        );

        expect(html).toContain('src="https://example.com/image.png"');
        expect(html).toContain('referrerpolicy="no-referrer"');
        expect(html).toContain('data-referrer-policy="no-referrer"');
        expect(html).not.toContain("crossorigin=");
    });

    it("站内相对路径图片不追加外链属性", () => {
        const html = sanitizeMarkdownHtml(
            '<img src="/images/example.png" alt="x" referrerpolicy="unsafe-url" crossorigin="use-credentials" />',
        );

        expect(html).toContain('src="/images/example.png"');
        expect(html).not.toContain("referrerpolicy=");
        expect(html).not.toContain("crossorigin=");
        expect(html).not.toContain("data-referrer-policy=");
        expect(html).not.toContain("data-cross-origin=");
    });

    it("已知高风险域名图片追加 anonymous CORS 兼容", () => {
        const html = sanitizeMarkdownHtml(
            '<img src="https://i0.hdslb.com/bfs/archive/demo.png" alt="x" />',
        );

        expect(html).toContain('referrerpolicy="no-referrer"');
        expect(html).toContain('crossorigin="anonymous"');
        expect(html).toContain('data-referrer-policy="no-referrer"');
        expect(html).toContain('data-cross-origin="anonymous"');
    });

    it("iframe 排版样式（width/max-width/overflow/background）被保留", () => {
        const html = sanitizeMarkdownHtml(
            '<iframe src="https://embed.music.apple.com/cn/album/1" style="width:100%;max-width:660px;overflow:hidden;background:transparent;"></iframe>',
        );

        expect(html).toContain("width:100%");
        expect(html).toContain("max-width:660px");
        expect(html).toContain("overflow:hidden");
        expect(html).toContain("background:transparent");
    });

    it("iframe 不允许危险定位样式", () => {
        const html = sanitizeMarkdownHtml(
            '<iframe src="https://embed.music.apple.com/cn/album/1" style="position:fixed;z-index:9999;top:0;width:100%"></iframe>',
        );

        expect(html).not.toContain("position:fixed");
        expect(html).not.toContain("z-index");
        expect(html).not.toContain("top:0");
        expect(html).toContain("width:100%");
    });
});
