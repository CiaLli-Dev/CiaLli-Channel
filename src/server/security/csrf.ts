/**
 * CSRF 双提交 Token
 *
 * Cookie（httpOnly: true）+ 请求头双重提交校验。
 * 使用 Node.js crypto.timingSafeEqual 做恒时比较。
 */
import { timingSafeEqual } from "node:crypto";

import type { APIContext } from "astro";

import { fail } from "@/server/api/response";

export const CSRF_COOKIE = "cialli_csrf";
export const CSRF_HEADER = "x-csrf-token";

function generateCsrfToken(): string {
    return crypto.randomUUID();
}

function isSecureRequest(url: URL): boolean {
    return url.protocol === "https:";
}

function resolveCsrfCookieOptions(context: APIContext): {
    httpOnly: boolean;
    sameSite: "lax";
    secure: boolean;
    path: string;
    maxAge: number;
} {
    return {
        // CSRF token 不再允许被前端 JS 直接读取，改为服务端注入到 <meta>
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureRequest(context.url),
        path: "/",
        maxAge: 86400,
    };
}

/** 读取当前请求可用的 CSRF token（用于服务端模板注入） */
export function readCsrfToken(context: APIContext): string {
    return context.cookies.get(CSRF_COOKIE)?.value ?? "";
}

/** 若 cookie 不存在则生成并 set，确保每个页面响应都携带 CSRF cookie */
export function ensureCsrfCookie(context: APIContext): string {
    const existing = context.cookies.get(CSRF_COOKIE)?.value;
    if (existing) return existing;

    const token = generateCsrfToken();
    context.cookies.set(CSRF_COOKIE, token, resolveCsrfCookieOptions(context));
    return token;
}

/** 登录等关键会话阶段强制轮换 CSRF token */
export function rotateCsrfCookie(context: APIContext): string {
    const token = generateCsrfToken();
    context.cookies.set(CSRF_COOKIE, token, resolveCsrfCookieOptions(context));
    return token;
}

/**
 * 校验 CSRF token：比对 cookie 值与 header 值。
 * 不匹配时返回 403 响应，匹配则返回 null。
 */
export function assertCsrfToken(context: APIContext): Response | null {
    const cookieValue = context.cookies.get(CSRF_COOKIE)?.value ?? "";
    const headerValue = context.request.headers.get(CSRF_HEADER) ?? "";

    if (!cookieValue || !headerValue) {
        return fail("CSRF 令牌无效", 403, "CSRF_INVALID");
    }

    // 使用 timingSafeEqual 做恒时比较，防止计时攻击
    const a = Buffer.from(cookieValue, "utf8");
    const b = Buffer.from(headerValue, "utf8");

    if (a.byteLength !== b.byteLength) {
        return fail("CSRF 令牌无效", 403, "CSRF_INVALID");
    }

    if (!timingSafeEqual(a, b)) {
        return fail("CSRF 令牌无效", 403, "CSRF_INVALID");
    }

    return null;
}
