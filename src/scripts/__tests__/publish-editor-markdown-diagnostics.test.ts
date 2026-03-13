import { describe, expect, it } from "vitest";

import { analyzeMarkdownSyntax } from "@/scripts/publish-editor-markdown-diagnostics";

describe("publish-editor-markdown-diagnostics", () => {
    it("未闭合代码块围栏会返回 error", () => {
        const diagnostics = analyzeMarkdownSyntax("```ts\nconst a = 1;");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.severity).toBe("error");
        expect(diagnostics[0]?.message).toContain("围栏未闭合");
        expect(diagnostics[0]?.line).toBe(1);
    });

    it("已闭合代码块围栏不会报错", () => {
        const diagnostics = analyzeMarkdownSyntax(
            "```ts\nconst a = 1;\n```\n正文",
        );
        expect(diagnostics).toHaveLength(0);
    });

    it("链接未闭合右括号会返回 error", () => {
        const diagnostics = analyzeMarkdownSyntax(
            "这是一个链接 [Home](/posts/new",
        );
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.severity).toBe("error");
        expect(diagnostics[0]?.message).toContain("缺少右括号");
    });

    it("代码块内的链接片段不会触发链接语法检查", () => {
        const diagnostics = analyzeMarkdownSyntax(
            "```md\n[Home](/posts/new\n```",
        );
        expect(diagnostics).toHaveLength(0);
    });

    it("未闭合行内反引号会返回 warning", () => {
        const diagnostics = analyzeMarkdownSyntax("这里有 `inline code 未闭合");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.severity).toBe("warning");
        expect(diagnostics[0]?.message).toContain("反引号");
    });

    it("标题 # 后缺空格会返回 error", () => {
        const diagnostics = analyzeMarkdownSyntax("#标题");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.severity).toBe("error");
        expect(diagnostics[0]?.message).toContain("标题语法");
    });

    it("列表奇数缩进会返回 warning", () => {
        const diagnostics = analyzeMarkdownSyntax("- item\n   - nested");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.severity).toBe("warning");
        expect(diagnostics[0]?.message).toContain("列表缩进建议");
    });

    it("列表层级跳跃过大会返回 warning", () => {
        const diagnostics = analyzeMarkdownSyntax("- item\n      - nested");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.severity).toBe("warning");
        expect(diagnostics[0]?.message).toContain("层级跳跃过大");
    });
});
