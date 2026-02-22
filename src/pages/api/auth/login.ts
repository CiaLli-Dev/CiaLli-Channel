import type { APIContext } from "astro";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
    DirectusAuthError,
    DIRECTUS_ACCESS_COOKIE_NAME,
    directusGetMe,
    directusLogin,
    DIRECTUS_REFRESH_COOKIE_NAME,
    getCookieOptions,
    getRememberCookieOptions,
    pickPublicUserInfo,
    REMEMBER_COOKIE_NAME,
    resolveAccessTokenMaxAgeSeconds,
    type PublicUserInfo,
} from "@/server/directus-auth";
import {
    clearRegistrationRequestCookie,
    normalizeRegistrationRequestId,
    REGISTRATION_REQUEST_COOKIE_NAME,
} from "@/server/auth/registration-request-cookie";
import { readMany } from "@/server/directus/client";
import {
    applyRateLimit,
    rateLimitResponse,
} from "@/server/security/rate-limit";
import { assertCsrfToken, rotateCsrfCookie } from "@/server/security/csrf";
import { AppError } from "@/server/api/errors";
import type { JsonObject, JsonValue } from "@/types/json";
import { getJsonString, isJsonObject } from "@utils/json-utils";

export const prerender = false;

function resolveTrustedClientIp(headers: Headers): string {
    const vercelForwarded = headers.get("x-vercel-forwarded-for");
    if (vercelForwarded) {
        return vercelForwarded.split(",")[0]?.trim() || "unknown";
    }

    const cloudflare = headers.get("cf-connecting-ip");
    if (cloudflare) {
        return cloudflare.trim();
    }

    const realIp = headers.get("x-real-ip");
    if (realIp) {
        return realIp.trim();
    }

    return "unknown";
}

function json<T>(data: T, init?: ResponseInit): Response {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...(init?.headers ?? {}),
        },
    });
}

function normalizeRateLimitEmailKey(email: string): string {
    return `email:${email.trim().toLowerCase()}`;
}

async function shouldClearRegistrationCookieOnLogin(
    context: APIContext,
    userId: string,
): Promise<boolean> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
        return false;
    }
    const requestId = normalizeRegistrationRequestId(
        context.cookies.get(REGISTRATION_REQUEST_COOKIE_NAME)?.value,
    );
    if (!requestId) {
        return false;
    }
    try {
        const rows = await readMany("app_user_registration_requests", {
            filter: { id: { _eq: requestId } } as JsonObject,
            limit: 1,
            fields: ["id", "request_status", "approved_user_id"],
        });
        const row = rows[0] as
            | { request_status?: unknown; approved_user_id?: unknown }
            | undefined;
        if (!row) {
            return true;
        }
        const status = String(row.request_status || "").trim();
        const approvedUserId = String(row.approved_user_id || "").trim();
        return status === "approved" && approvedUserId === normalizedUserId;
    } catch (error) {
        console.warn(
            "[api/auth/login] skip registration cookie clear check:",
            error,
        );
        return false;
    }
}

export async function POST(context: APIContext): Promise<Response> {
    const { request, cookies, url } = context;

    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
        return json(
            { ok: false, message: i18n(I18nKey.apiIllegalOrigin) },
            { status: 403 },
        );
    }

    const csrfDenied = assertCsrfToken(context);
    if (csrfDenied) return csrfDenied;

    const ip = resolveTrustedClientIp(request.headers);
    let ipRate: Awaited<ReturnType<typeof applyRateLimit>>;
    try {
        ipRate = await applyRateLimit(ip, "auth");
    } catch (error) {
        if (
            error instanceof AppError &&
            error.message.includes("限流服务未配置")
        ) {
            return json(
                {
                    ok: false,
                    message: i18n(I18nKey.apiRateLimitServiceMissing),
                },
                { status: 500 },
            );
        }
        console.error("[api/auth/login] rate limit failed:", error);
        return json(
            { ok: false, message: i18n(I18nKey.apiRateLimitCheckFailed) },
            { status: 500 },
        );
    }
    if (!ipRate.ok) {
        return rateLimitResponse(ipRate);
    }

    let body: JsonValue;
    try {
        body = (await request.json()) as JsonValue;
    } catch {
        return json(
            { ok: false, message: i18n(I18nKey.apiInvalidJsonBody) },
            { status: 400 },
        );
    }

    const bodyObject: JsonObject = isJsonObject(body) ? body : {};
    const email = (getJsonString(bodyObject, "email") ?? "").trim();
    const password = getJsonString(bodyObject, "password") ?? "";
    const remember = bodyObject.remember !== false;

    if (!email || !password) {
        return json(
            { ok: false, message: i18n(I18nKey.apiAuthEmailPasswordRequired) },
            { status: 400 },
        );
    }

    // 登录限流采用 IP + 账号双维度，避免通过伪造来源 IP 绕过限制。
    let emailRate: Awaited<ReturnType<typeof applyRateLimit>>;
    try {
        emailRate = await applyRateLimit(
            normalizeRateLimitEmailKey(email),
            "auth",
        );
    } catch (error) {
        if (
            error instanceof AppError &&
            error.message.includes("限流服务未配置")
        ) {
            return json(
                {
                    ok: false,
                    message: i18n(I18nKey.apiRateLimitServiceMissing),
                },
                { status: 500 },
            );
        }
        console.error("[api/auth/login] account rate limit failed:", error);
        return json(
            { ok: false, message: i18n(I18nKey.apiRateLimitCheckFailed) },
            { status: 500 },
        );
    }
    if (!emailRate.ok) {
        return rateLimitResponse(emailRate);
    }

    const sessionOnly = !remember;

    try {
        const tokens = await directusLogin({ email, password });
        cookies.set(
            DIRECTUS_REFRESH_COOKIE_NAME,
            tokens.refreshToken,
            getCookieOptions({
                requestUrl: url,
                sessionOnly,
            }),
        );
        cookies.set(
            DIRECTUS_ACCESS_COOKIE_NAME,
            tokens.accessToken,
            getCookieOptions({
                requestUrl: url,
                maxAge: resolveAccessTokenMaxAgeSeconds(tokens.expiresMs),
                sessionOnly,
            }),
        );
        cookies.set(
            REMEMBER_COOKIE_NAME,
            remember ? "1" : "0",
            getRememberCookieOptions({ requestUrl: url, remember }),
        );
        // 登录成功后轮换 CSRF token，避免沿用登录前 token。
        rotateCsrfCookie(context);

        let user: PublicUserInfo = {
            id: "",
            email,
            name: email,
        };
        try {
            const me = await directusGetMe({ accessToken: tokens.accessToken });
            const picked = pickPublicUserInfo(me);
            user = {
                id: picked.id || user.id,
                email: picked.email || user.email,
                name: picked.name || user.name,
                avatarUrl: picked.avatarUrl || user.avatarUrl,
            };
        } catch {
            // 若 /users/me 失败，不影响登录态写入，前台可再调用 /api/auth/me
        }
        if (await shouldClearRegistrationCookieOnLogin(context, user.id)) {
            clearRegistrationRequestCookie(context);
        }

        return json(
            { ok: true, user },
            {
                headers: {
                    "X-RateLimit-Remaining": String(
                        Math.min(ipRate.remaining, emailRate.remaining),
                    ),
                },
            },
        );
    } catch (error) {
        const status =
            error instanceof DirectusAuthError && error.directusStatus === 401
                ? 401
                : 500;
        return json(
            {
                ok: false,
                message:
                    status === 401
                        ? i18n(I18nKey.apiAuthInvalidCredentials)
                        : i18n(I18nKey.apiAuthLoginFailed),
            },
            { status },
        );
    }
}
