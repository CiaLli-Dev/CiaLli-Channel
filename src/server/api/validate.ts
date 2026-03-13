/**
 * Zod 校验基础设施
 *
 * 提供统一的请求体和查询参数校验。
 * 校验失败时抛出 AppError(400)，由 withErrorHandler 统一捕获。
 */
import type * as z from "zod";

import { badRequest } from "@/server/api/errors";

/** 格式化 Zod 校验错误为可读字符串 */
function formatZodError(error: z.ZodError): string {
    return error.issues
        .map((i) =>
            i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message,
        )
        .join("; ");
}

/**
 * 解析并校验请求体，失败时抛出 AppError(400, "VALIDATION_ERROR")
 *
 * @example
 * const input = validateBody(CreateArticleSchema, body);
 * // input 已通过校验，类型安全
 */
export function validateBody<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        throw badRequest("VALIDATION_ERROR", formatZodError(result.error));
    }
    return result.data;
}

/**
 * 校验 URL 查询参数，失败时抛出 AppError(400, "VALIDATION_ERROR")
 *
 * 将 URLSearchParams 转为 Record 后校验。
 * 注意：所有值都是 string，schema 中需要使用 z.coerce 进行类型转换。
 */
export function validateQuery<T>(
    schema: z.ZodType<T>,
    params: URLSearchParams,
): T {
    const obj: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
        obj[key] = value;
    }
    return validateBody(schema, obj);
}
