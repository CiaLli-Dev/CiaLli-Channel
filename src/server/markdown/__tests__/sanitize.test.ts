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
});
