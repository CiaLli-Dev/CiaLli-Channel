import { describe, expect, it } from "vitest";

import {
    detectMarkdownFeatures,
    renderMarkdown,
} from "@/server/markdown/render";

describe("detectMarkdownFeatures", () => {
    it("正确识别数学、指令与 mermaid", () => {
        const features = detectMarkdownFeatures(
            [
                "$a+b$",
                '::note{title="提示"}',
                "内容",
                "::",
                "```mermaid",
                "graph TD",
                "A-->B",
                "```",
            ].join("\n"),
        );

        expect(features).toEqual({
            hasMath: true,
            hasDirective: true,
            hasMermaid: true,
        });
    });

    it("无特征语法时全部为 false", () => {
        const features = detectMarkdownFeatures("普通段落\n\n没有扩展语法");
        expect(features).toEqual({
            hasMath: false,
            hasDirective: false,
            hasMermaid: false,
        });
    });
});

describe("renderMarkdown mode", () => {
    it("full 模式保留标题锚点，fast 模式跳过锚点", async () => {
        const fullHtml = await renderMarkdown("# Heading", {
            target: "page",
            mode: "full",
        });
        const fastHtml = await renderMarkdown("# Heading", {
            target: "page",
            mode: "fast",
        });

        expect(fullHtml).toContain('class="anchor"');
        expect(fastHtml).not.toContain('class="anchor"');
    });

    it("fast 模式仍执行 sanitize", async () => {
        const html = await renderMarkdown(
            "<script>alert(1)</script>\n\n**safe**",
            {
                target: "page",
                mode: "fast",
            },
        );

        expect(html).not.toContain("<script>");
        expect(html).toContain("<strong>safe</strong>");
    });

    it("不保留粘贴图片的 blob 协议", async () => {
        const blobUrl = "blob:https://example.com/preview-image";
        const html = await renderMarkdown(`![paste-image](${blobUrl})`, {
            target: "page",
            mode: "full",
        });

        expect(html).not.toContain(`src="${blobUrl}"`);
        expect(html).toContain("<img");
    });

    it("预览模式允许保留 blob 协议，且不污染严格缓存", async () => {
        const blobUrl = "blob:https://example.com/preview-image";
        const strictHtml = await renderMarkdown(`![paste-image](${blobUrl})`, {
            target: "page",
            mode: "full",
        });
        const previewHtml = await renderMarkdown(`![paste-image](${blobUrl})`, {
            target: "page",
            mode: "full",
            allowBlobImages: true,
        });

        expect(strictHtml).not.toContain(`src="${blobUrl}"`);
        expect(previewHtml).toContain(`src="${blobUrl}"`);
    });

    it("将 Markdown 图片 alt 渲染为图注", async () => {
        const html = await renderMarkdown(
            "![这是图片描述](https://example.com/image.png)",
            {
                target: "page",
                mode: "full",
            },
        );

        expect(html).toContain("<figure");
        expect(html).toContain("md-image-figure");
        expect(html).toContain('alt="这是图片描述"');
        expect(html).toContain("<figcaption");
        expect(html).toContain("md-image-caption");
        expect(html).toContain("这是图片描述</figcaption>");
    });

    it("链接包裹图片时仍渲染图注", async () => {
        const html = await renderMarkdown(
            "[![跳转图注](https://example.com/image.png)](https://example.com)",
            {
                target: "page",
                mode: "full",
            },
        );

        expect(html).toContain("<figure");
        expect(html).toContain('<a href="https://example.com"');
        expect(html).toContain("跳转图注</figcaption>");
    });

    it("图片 alt 为空时不渲染图注", async () => {
        const html = await renderMarkdown(
            "![](https://example.com/image.png)",
            {
                target: "page",
                mode: "full",
            },
        );

        expect(html).toContain("<figure");
        expect(html).not.toContain("<figcaption");
    });

    it("保留图片宽度语法并从图注文本中移除宽度标记", async () => {
        const html = await renderMarkdown(
            "![示例图片 w-60%](https://example.com/image.png)",
            {
                target: "page",
                mode: "full",
            },
        );

        expect(html).toContain('width="60%"');
        expect(html).toContain('alt="示例图片"');
        expect(html).toContain("示例图片</figcaption>");
        expect(html).not.toContain("w-60%");
    });
});
