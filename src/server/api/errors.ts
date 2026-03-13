/**
 * 统一应用错误类及工厂函数
 *
 * 用于提供结构化的错误信息。
 */
export class AppError extends Error {
    /** 机器可读错误码 */
    readonly code: string;
    /** HTTP 状态码 */
    readonly status: number;
    /** 可选附加信息（仅开发环境序列化） */
    readonly details?: Record<string, unknown>;

    constructor(
        code: string,
        message: string,
        status = 400,
        details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

/** 400 Bad Request */
export function badRequest(code: string, message: string): AppError {
    return new AppError(code, message, 400);
}

/** 401 Unauthorized */
export function unauthorized(message = "未登录"): AppError {
    return new AppError("UNAUTHORIZED", message, 401);
}

/** 403 Forbidden */
export function forbidden(code = "FORBIDDEN", message = "权限不足"): AppError {
    return new AppError(code, message, 403);
}

/** 404 Not Found */
export function notFound(
    code = "ITEM_NOT_FOUND",
    message = "资源不存在",
): AppError {
    return new AppError(code, message, 404);
}

/** 409 Conflict */
export function conflict(code: string, message: string): AppError {
    return new AppError(code, message, 409);
}

/** 500 Internal Server Error */
export function internal(
    message = "服务端错误",
    details?: Record<string, unknown>,
): AppError {
    return new AppError("INTERNAL_ERROR", message, 500, details);
}
