import { describe, expect, it, vi } from "vitest";

import {
    buildSummaryContentHash,
    buildSummaryJobDedupeKey,
} from "@/server/ai-summary/hash";
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
});
