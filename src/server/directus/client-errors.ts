/**
 * Directus 客户端错误处理工具函数。
 * 从 client.ts 分离以保持文件大小在限制内。
 */

import { isDirectusError } from "@directus/sdk";

import { AppError, internal } from "@/server/api/errors";

type DirectusErrorContext = {
    action?: string;
    scope?: string;
    targetHost?: string;
    timeoutMs?: number;
};

export function getDirectusErrorStatus(error: unknown): number | null {
    if (!isDirectusError(error)) {
        return null;
    }
    const response = error.response;
    if (response instanceof Response) {
        return response.status;
    }
    return null;
}

export function getDirectusErrorCodes(error: unknown): string[] {
    if (!isDirectusError(error) || !Array.isArray(error.errors)) {
        return [];
    }
    return error.errors
        .map((entry) => entry.extensions?.code)
        .filter(
            (code): code is string => typeof code === "string" && Boolean(code),
        );
}

function readErrorText(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractErrorLikeDetails(error: unknown): Record<string, unknown> {
    if (!(error instanceof Error)) {
        return {};
    }

    const details: Record<string, unknown> = {
        errorName: error.name,
        errorMessage: error.message,
    };
    const code = readErrorText((error as Error & { code?: unknown }).code);
    if (code) {
        details.errorCode = code;
    }

    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
        details.causeName = cause.name;
        details.causeMessage = cause.message;
        const causeCode = readErrorText(
            (cause as Error & { code?: unknown }).code,
        );
        if (causeCode) {
            details.causeCode = causeCode;
        }
    } else {
        const causeText = readErrorText(cause);
        if (causeText) {
            details.causeMessage = causeText;
        }
    }

    return details;
}

function mergeDirectusErrorDetails(
    error: unknown,
    context?: DirectusErrorContext,
): Record<string, unknown> {
    const details: Record<string, unknown> = {
        ...extractErrorLikeDetails(error),
    };

    if (context?.action) {
        details.action = context.action;
    }
    if (context?.scope) {
        details.scope = context.scope;
    }
    if (context?.targetHost) {
        details.targetHost = context.targetHost;
    }
    if (typeof context?.timeoutMs === "number") {
        details.timeoutMs = context.timeoutMs;
    }

    return details;
}

export function toDirectusError(
    action: string,
    error: unknown,
    context?: Omit<DirectusErrorContext, "action">,
): AppError {
    const details = mergeDirectusErrorDetails(error, {
        ...context,
        action,
    });

    if (!isDirectusError(error)) {
        if (error instanceof AppError) {
            return error;
        }
        return error instanceof Error
            ? internal(
                  `[directus/client] ${action}失败: ${error.message}`,
                  details,
              )
            : internal(
                  `[directus/client] ${action}失败: ${String(error)}`,
                  details,
              );
    }

    const status = getDirectusErrorStatus(error);
    const statusText =
        typeof status === "number" ? `(${status})` : "(unknown status)";
    const codeText = getDirectusErrorCodes(error).join(",");
    const detail =
        error.errors
            ?.map((entry) => {
                const code = entry.extensions?.code || "UNKNOWN";
                return `${code}:${entry.message}`;
            })
            .join("; ") || error.message;

    const suffix = codeText ? ` codes=${codeText}` : "";
    const message = `[directus/client] ${action}失败 ${statusText}${suffix}: ${detail}`;

    if (status === 403) {
        return new AppError("DIRECTUS_FORBIDDEN", message, 403, details);
    }
    if (status === 404) {
        return new AppError("DIRECTUS_NOT_FOUND", message, 404, details);
    }
    return new AppError("DIRECTUS_ERROR", message, status || 500, details);
}

export function isDirectusItemNotFound(error: unknown): boolean {
    const status = getDirectusErrorStatus(error);
    if (status === 404) {
        return true;
    }
    return getDirectusErrorCodes(error).includes("ITEM_NOT_FOUND");
}
