export type AiSummaryErrorCode =
    | "CONFIG_MISSING"
    | "ARTICLE_SKIPPED"
    | "PROVIDER_RATE_LIMIT"
    | "PROVIDER_SERVER_ERROR"
    | "PROVIDER_BAD_RESPONSE"
    | "PROVIDER_TIMEOUT"
    | "UNKNOWN";

export class AiSummaryError extends Error {
    readonly code: AiSummaryErrorCode;
    readonly retryable: boolean;

    constructor(
        code: AiSummaryErrorCode,
        message: string,
        options: { retryable?: boolean } = {},
    ) {
        super(message);
        this.name = "AiSummaryError";
        this.code = code;
        this.retryable = options.retryable ?? false;
    }
}

export function classifyAiSummaryError(error: unknown): {
    code: AiSummaryErrorCode;
    message: string;
    retryable: boolean;
} {
    if (error instanceof AiSummaryError) {
        return {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
        };
    }
    const message = error instanceof Error ? error.message : "AI 摘要失败";
    return { code: "UNKNOWN", message, retryable: true };
}

export function buildRetryDelayMs(attempts: number): number {
    const normalizedAttempts = Math.max(1, attempts);
    return Math.min(15 * 60_000, 30_000 * 2 ** (normalizedAttempts - 1));
}
