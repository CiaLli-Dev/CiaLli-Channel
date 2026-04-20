import type { APIContext } from "astro";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { loginWithPassword } from "@/server/application/auth/login.service";
import {
    DIRECTUS_ACCESS_COOKIE_NAME,
    DIRECTUS_REFRESH_COOKIE_NAME,
    getCookieOptions,
    getRememberCookieOptions,
    REMEMBER_COOKIE_NAME,
    resolveAccessTokenMaxAgeSeconds,
} from "@/server/directus-auth";
import {
    clearRegistrationRequestCookie,
    REGISTRATION_REQUEST_COOKIE_NAME,
} from "@/server/auth/registration-request-cookie";
import {
    applyRateLimit,
    rateLimitResponse,
} from "@/server/security/rate-limit";
import { assertCsrfToken, rotateCsrfCookie } from "@/server/security/csrf";
import { AppError } from "@/server/api/errors";
import type { JsonObject, JsonValue } from "@/types/json";
import { getJsonString, isJsonObject } from "@utils/json-utils";

const AUTH_NO_STORE = "private, no-store";

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
            "Cache-Control": AUTH_NO_STORE,
            ...(init?.headers ?? {}),
        },
    });
}

function normalizeRateLimitEmailKey(email: string): string {
    return `email:${email.trim().toLowerCase()}`;
}

async function applyRateLimitOrError(
    key: string,
): Promise<
    | { ok: true; result: Awaited<ReturnType<typeof applyRateLimit>> }
    | { ok: false; response: Response }
> {
    try {
        const result = await applyRateLimit(key, "auth");
        return { ok: true, result };
    } catch (error) {
        if (
            error instanceof AppError &&
            error.message.includes("限流服务未配置")
        ) {
            return {
                ok: false,
                response: json(
                    {
                        ok: false,
                        message: i18n(
                            I18nKey.interactionApiRateLimitServiceMissing,
                        ),
                    },
                    { status: 500 },
                ),
            };
        }
        console.error("[api/auth/login] rate limit failed:", error);
        return {
            ok: false,
            response: json(
                {
                    ok: false,
                    message: i18n(I18nKey.interactionApiRateLimitCheckFailed),
                },
                { status: 500 },
            ),
        };
    }
}

function setLoginCookies(
    context: APIContext,
    tokens: { refreshToken: string; accessToken: string; expiresMs?: number },
    remember: boolean,
): void {
    const { cookies, url } = context;
    const sessionOnly = !remember;
    cookies.set(
        DIRECTUS_REFRESH_COOKIE_NAME,
        tokens.refreshToken,
        getCookieOptions({ requestUrl: url, sessionOnly }),
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
}

function buildLoginErrorResponse(status: 401 | 500): Response {
    return json(
        {
            ok: false,
            message:
                status === 401
                    ? i18n(I18nKey.interactionApiAuthInvalidCredentials)
                    : i18n(I18nKey.interactionApiAuthLoginFailed),
        },
        { status },
    );
}

type LoginCredentials = {
    email: string;
    password: string;
    remember: boolean;
};

async function parseLoginBody(
    request: Request,
): Promise<LoginCredentials | Response> {
    let body: JsonValue;
    try {
        body = (await request.json()) as JsonValue;
    } catch {
        return json(
            { ok: false, message: i18n(I18nKey.interactionApiInvalidJsonBody) },
            { status: 400 },
        );
    }
    const bodyObject: JsonObject = isJsonObject(body) ? body : {};
    const email = (getJsonString(bodyObject, "email") ?? "").trim();
    const password = getJsonString(bodyObject, "password") ?? "";
    const remember = bodyObject.remember !== false;
    if (!email || !password) {
        return json(
            {
                ok: false,
                message: i18n(I18nKey.interactionApiAuthEmailPasswordRequired),
            },
            { status: 400 },
        );
    }
    return { email, password, remember };
}

async function executeLogin(
    context: APIContext,
    credentials: LoginCredentials,
    rateLimitRemaining: number,
): Promise<Response> {
    const result = await loginWithPassword({
        email: credentials.email,
        password: credentials.password,
        registrationRequestCookie: context.cookies.get(
            REGISTRATION_REQUEST_COOKIE_NAME,
        )?.value,
    });
    if (!result.ok) {
        return buildLoginErrorResponse(result.status);
    }

    setLoginCookies(context, result.tokens, credentials.remember);
    // 登录成功后轮换 CSRF token，避免沿用登录前 token。
    rotateCsrfCookie(context);

    if (result.clearRegistrationCookie) {
        clearRegistrationRequestCookie(context);
    }

    return json(
        { ok: true, user: result.user },
        {
            headers: {
                "X-RateLimit-Remaining": String(rateLimitRemaining),
            },
        },
    );
}

export async function POST(context: APIContext): Promise<Response> {
    const { request, url } = context;

    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
        return json(
            { ok: false, message: i18n(I18nKey.interactionApiIllegalOrigin) },
            { status: 403 },
        );
    }

    const csrfDenied = assertCsrfToken(context);
    if (csrfDenied) return csrfDenied;

    const ip = resolveTrustedClientIp(request.headers);
    const ipRateResult = await applyRateLimitOrError(ip);
    if (!ipRateResult.ok) return ipRateResult.response;
    const ipRate = ipRateResult.result;
    if (!ipRate.ok) return rateLimitResponse(ipRate);

    const parsed = await parseLoginBody(request);
    if (parsed instanceof Response) return parsed;

    // 登录限流采用 IP + 账号双维度，避免通过伪造来源 IP 绕过限制。
    const emailRateResult = await applyRateLimitOrError(
        normalizeRateLimitEmailKey(parsed.email),
    );
    if (!emailRateResult.ok) return emailRateResult.response;
    const emailRate = emailRateResult.result;
    if (!emailRate.ok) return rateLimitResponse(emailRate);

    return executeLogin(
        context,
        parsed,
        Math.min(ipRate.remaining, emailRate.remaining),
    );
}
