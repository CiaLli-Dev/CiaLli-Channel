import { describe, expect, it, vi } from "vitest";

import {
    buildSummaryContentHash,
    buildSummaryJobDedupeKey,
} from "@/server/ai-summary/hash";
import {
    buildChunkSummaryMessages,
    buildFinalSummaryMessages,
    normalizeAiSummaryText,
    resolveAiSummaryPromptVersion,
} from "@/server/ai-summary/prompts";
import { callOpenAICompatibleChatCompletion } from "@/server/ai-summary/provider";
import { splitMarkdownForSummary } from "@/server/ai-summary/splitter";

describe("AI summary hash helpers", () => {
    it("builds stable content hash and dedupe key", () => {
        const hash = buildSummaryContentHash({
            title: "标题",
            bodyMarkdown: "# 正文\n内容",
        });

        expect(hash).toMatch(/^[a-f0-9]{64}$/u);
        expect(
            buildSummaryJobDedupeKey({
                articleId: "article-1",
                contentHash: hash,
                promptVersion: "v1",
                targetLength: "medium",
            }),
        ).toBe(`article:article-1:hash:${hash}:prompt:v1:target:medium`);
    });
});

describe("splitMarkdownForSummary", () => {
    it("keeps fenced code blocks together while chunking long markdown", () => {
        const markdown = [
            "# 第一节",
            "这是一段正文。",
            "```ts",
            "const value = 1;",
            "```",
            "## 第二节",
            "后续内容".repeat(200),
        ].join("\n");

        const chunks = splitMarkdownForSummary(markdown, {
            targetChars: 120,
            maxChars: 240,
        });

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.some((chunk) => chunk.includes("const value = 1;"))).toBe(
            true,
        );
        expect(chunks.every((chunk) => chunk.length <= 240)).toBe(true);
    });
});

describe("AI summary prompts", () => {
    it("asks for paragraph-first summaries and limits Markdown syntax", () => {
        const chunkMessages = buildChunkSummaryMessages({
            language: "zh_CN",
            title: "标题",
            chunk: "# 正文\n内容",
            chunkIndex: 0,
            chunkCount: 2,
        });
        const finalMessages = buildFinalSummaryMessages({
            language: "zh_CN",
            title: "标题",
            chunkSummaries: ["分块摘要"],
        });
        const content = [...chunkMessages, ...finalMessages]
            .map((message) => message.content)
            .join("\n");

        expect(content).toContain("自然段");
        expect(content).toContain("段落文本");
        expect(content).toContain("第三者视角");
        expect(content).toContain("不要使用项目符号、编号或小标题");
        expect(content).toContain(
            "不使用 Markdown 标题、列表、代码块、表格、引用、链接或图片语法",
        );
    });

    it("builds English prompts when the site language is English", () => {
        const messages = buildFinalSummaryMessages({
            language: "en",
            title: "Release notes",
            chunkSummaries: ["Summary for the first chunk."],
        });
        const content = messages.map((message) => message.content).join("\n");

        expect(content).toContain(
            "The output language must match the site's language setting",
        );
        expect(content).toContain("80-160 word English summary");
        expect(content).toContain("third-person overview of the article");
    });

    it("builds Japanese prompts when the site language is Japanese", () => {
        const messages = buildChunkSummaryMessages({
            language: "ja",
            title: "記事タイトル",
            chunk: "本文",
            chunkIndex: 0,
            chunkCount: 1,
        });
        const content = messages.map((message) => message.content).join("\n");

        expect(content).toContain(
            "出力言語はサイトの言語設定と一致させてください",
        );
        expect(content).toContain("自然な段落");
    });

    it("includes language in prompt version resolution", () => {
        expect(resolveAiSummaryPromptVersion("en")).toBe("v4:en");
        expect(resolveAiSummaryPromptVersion("zh_CN")).toBe("v4:zh_CN");
        expect(resolveAiSummaryPromptVersion("ko")).toBe("v4:en");
    });

    it("normalizes accidental Markdown into paragraph text", () => {
        const normalized = normalizeAiSummaryText(
            [
                "## 摘要",
                "- **核心结论**：文章说明了 `[目标](https://example.com)`。",
                "1. `实现方式` 以异步任务为主。",
                "```ts",
                "const skipped = true;",
                "```",
            ].join("\n"),
        );

        expect(normalized).toBe(
            [
                "摘要",
                "核心结论：文章说明了 目标。",
                "实现方式 以异步任务为主。",
            ].join("\n\n"),
        );
    });
});

describe("callOpenAICompatibleChatCompletion", () => {
    it("posts chat completions request and returns assistant content", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: "这是摘要。",
                            },
                        },
                    ],
                }),
                { status: 200 },
            ),
        );

        const result = await callOpenAICompatibleChatCompletion({
            fetch: fetchMock,
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test",
            model: "test-model",
            messages: [{ role: "user", content: "总结" }],
            maxTokens: 300,
        });

        expect(result).toBe("这是摘要。");
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.example.com/v1/chat/completions",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: "Bearer sk-test",
                }),
            }),
        );
    });

    it("maps provider timeouts to retryable timeout errors", async () => {
        const fetchMock = vi.fn().mockRejectedValue(
            Object.assign(new Error("The operation timed out"), {
                name: "TimeoutError",
            }),
        );

        await expect(
            callOpenAICompatibleChatCompletion({
                fetch: fetchMock,
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-test",
                model: "test-model",
                messages: [{ role: "user", content: "总结" }],
                maxTokens: 300,
            }),
        ).rejects.toMatchObject({
            code: "PROVIDER_TIMEOUT",
            retryable: true,
        });
    });
});
