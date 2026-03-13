/**
 * API 统一错误处理包装器
 *
 * 职责：
 * 1. 计时 — 记录请求耗时
 * 2. 捕获异常 — AppError 直接格式化，未知错误按 500 处理
 * 3. 结构化日志 — 使用 createRequestLogger 记录错误详情
 * 4. 堆栈控制 — 生产环境不在响应中暴露 stack
 */
import type { APIContext } from "astro";

import { AppError } from "@/server/api/errors";
import { createRequestLogger } from "@/server/api/logger";
import { fail } from "@/server/api/response";

function toPublicAppError(error: AppError): AppError {
    // Directus 相关错误对外统一脱敏，避免泄露内部集合名/字段/错误码细节。
    if (!error.code.startsWith("DIRECTUS_")) {
        return error;
    }

    if (error.status === 403) {
        return new AppError("DIRECTUS_FORBIDDEN", "权限不足", 403);
    }

    if (error.status === 404) {
        return new AppError("DIRECTUS_NOT_FOUND", "资源不存在", 404);
    }

    if (error.status >= 500) {
        return new AppError("DIRECTUS_ERROR", "服务端错误", error.status);
    }

    return new AppError("DIRECTUS_ERROR", "请求参数无效", error.status);
}

export function withErrorHandler(
    handler: (context: APIContext) => Promise<Response>,
): (context: APIContext) => Promise<Response> {
    return async (context: APIContext): Promise<Response> => {
        const start = Date.now();
        const logger = createRequestLogger(context);

        try {
            const response = await handler(context);

            const latency = Date.now() - start;
            logger.info("request completed", {
                status: response.status,
                latency,
            });

            return response;
        } catch (error) {
            const latency = Date.now() - start;
            let response: Response;

            if (error instanceof AppError) {
                const publicError = toPublicAppError(error);
                response = fail(
                    publicError.message,
                    publicError.status,
                    publicError.code,
                );

                logger.error("request failed", error, {
                    status: error.status,
                    code: error.code,
                    latency,
                    ...(error.details ? { details: error.details } : {}),
                });
            } else {
                // 未预期的异常统一按 500 处理
                response = fail("服务端错误", 500, "INTERNAL_ERROR");

                logger.error("unexpected error", error, {
                    status: 500,
                    latency,
                });
            }

            return response;
        }
    };
}
