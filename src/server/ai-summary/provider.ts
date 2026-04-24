import type { AiSummaryChatMessage } from "@/server/ai-summary/prompts";
import { AiSummaryError } from "@/server/ai-summary/errors";

import { validateAiBaseUrlForCurrentEnvironment } from "./base-url";

type ProviderFetch = typeof fetch;

export type OpenAICompatibleChatCompletionInput = {
    fetch?: ProviderFetch;
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: AiSummaryChatMessage[];
    maxTokens: number;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;

function readProviderTimeoutMs(): number {
    const raw = String(
        process.env.AI_SUMMARY_PROVIDER_TIMEOUT_MS ||
            import.meta.env.AI_SUMMARY_PROVIDER_TIMEOUT_MS ||
            "",
    ).trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1_000) {
        return DEFAULT_PROVIDER_TIMEOUT_MS;
    }
    return Math.floor(parsed);
}

function buildChatCompletionsUrl(baseUrl: string): string {
    const normalized = validateAiBaseUrlForCurrentEnvironment(baseUrl);
    if (!normalized) {
        throw new AiSummaryError("CONFIG_MISSING", "AI API Base URL 未配置");
    }
    return `${normalized}/chat/completions`;
}

function readAssistantContent(payload: unknown): string {
    if (!payload || typeof payload !== "object") {
        return "";
    }
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) {
        return "";
    }
    const first = choices[0];
    if (!first || typeof first !== "object") {
        return "";
    }
    const message = (first as { message?: unknown }).message;
    if (!message || typeof message !== "object") {
        return "";
    }
    return String((message as { content?: unknown }).content || "").trim();
}

function isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    return (
        error.name === "AbortError" ||
        error.name === "TimeoutError" ||
        /aborted|timeout/iu.test(error.message)
    );
}

export async function callOpenAICompatibleChatCompletion(
    input: OpenAICompatibleChatCompletionInput,
): Promise<string> {
    const fetchImpl = input.fetch ?? fetch;
    let response: Response;
    try {
        response = await fetchImpl(buildChatCompletionsUrl(input.baseUrl), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${input.apiKey}`,
            },
            body: JSON.stringify({
                model: input.model,
                messages: input.messages,
                temperature: 0.2,
                max_tokens: input.maxTokens,
            }),
            signal: AbortSignal.timeout(readProviderTimeoutMs()),
        });
    } catch (error) {
        if (isAbortLikeError(error)) {
            throw new AiSummaryError("PROVIDER_TIMEOUT", "AI 服务请求超时", {
                retryable: true,
            });
        }
        throw error;
    }

    if (response.status === 429) {
        throw new AiSummaryError("PROVIDER_RATE_LIMIT", "AI 服务限流", {
            retryable: true,
        });
    }
    if (response.status >= 500) {
        throw new AiSummaryError("PROVIDER_SERVER_ERROR", "AI 服务暂不可用", {
            retryable: true,
        });
    }
    if (!response.ok) {
        throw new AiSummaryError(
            "PROVIDER_BAD_RESPONSE",
            `AI 服务响应异常：${response.status}`,
        );
    }

    const payload = (await response.json()) as unknown;
    const content = readAssistantContent(payload);
    if (!content) {
        throw new AiSummaryError("PROVIDER_BAD_RESPONSE", "AI 摘要内容为空", {
            retryable: true,
        });
    }
    return content;
}
