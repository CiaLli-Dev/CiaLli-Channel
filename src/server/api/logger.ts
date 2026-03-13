/**
 * 结构化请求日志
 *
 * 每条日志自动包含 requestId、method、path 等上下文字段，
 * 输出 JSON 格式，方便 Vercel / 日志系统按字段过滤查询。
 */
import type { APIContext } from "astro";

import { getClientIp } from "@/server/directus-auth";

export type RequestLogger = {
    info: (message: string, extra?: Record<string, unknown>) => void;
    warn: (message: string, extra?: Record<string, unknown>) => void;
    error: (
        message: string,
        error?: unknown,
        extra?: Record<string, unknown>,
    ) => void;
};

/** 需要脱敏的查询参数名 */
const SENSITIVE_PARAMS = new Set([
    "token",
    "password",
    "secret",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "authorization",
]);

/** 对查询参数中的敏感字段进行脱敏 */
function sanitizePath(url: URL): string {
    const pathname = url.pathname;
    if (!url.search) {
        return pathname;
    }
    const params = new URLSearchParams(url.search);
    for (const key of params.keys()) {
        if (SENSITIVE_PARAMS.has(key.toLowerCase())) {
            params.set(key, "***");
        }
    }
    return `${pathname}?${params.toString()}`;
}

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    requestId: string;
    method: string;
    path: string;
    message: string;
    [key: string]: unknown;
}

function buildEntry(
    level: LogLevel,
    context: APIContext,
    message: string,
    extra?: Record<string, unknown>,
): LogEntry {
    return {
        timestamp: new Date().toISOString(),
        level,
        requestId: (context.locals.requestId as string) ?? "unknown",
        method: context.request.method,
        path: sanitizePath(context.url),
        message,
        ...extra,
    };
}

/**
 * 创建与请求上下文绑定的结构化日志器
 */
export function createRequestLogger(context: APIContext): RequestLogger {
    return {
        info(message: string, extra?: Record<string, unknown>) {
            const entry = buildEntry("info", context, message, extra);
            console.info(JSON.stringify(entry));
        },

        warn(message: string, extra?: Record<string, unknown>) {
            const entry = buildEntry("warn", context, message, extra);
            console.warn(JSON.stringify(entry));
        },

        error(
            message: string,
            error?: unknown,
            extra?: Record<string, unknown>,
        ) {
            const entry = buildEntry("error", context, message, extra);

            // 错误信息
            if (error instanceof Error) {
                entry.errorMessage = error.message;
                // 开发环境输出 stack
                if (!import.meta.env.PROD) {
                    entry.stack = error.stack;
                }
            } else if (error !== undefined) {
                entry.errorMessage = String(error);
            }

            // 5xx 错误记录 IP
            const status = (extra?.status as number) ?? 0;
            if (status >= 500) {
                entry.ip = getClientIp(context.request.headers);
            }

            console.error(JSON.stringify(entry));
        },
    };
}
