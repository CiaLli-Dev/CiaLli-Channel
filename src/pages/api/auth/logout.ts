import type { APIContext } from "astro";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { logoutWithRefreshToken } from "@/server/application/auth/logout.service";
import {
    DIRECTUS_ACCESS_COOKIE_NAME,
    DIRECTUS_REFRESH_COOKIE_NAME,
    getCookieOptions,
    REMEMBER_COOKIE_NAME,
} from "@/server/directus-auth";
import { assertCsrfToken } from "@/server/security/csrf";

const AUTH_NO_STORE = "private, no-store";

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

function clearAuthCookie(context: APIContext) {
    const { cookies, url } = context;
    try {
        cookies.delete(DIRECTUS_REFRESH_COOKIE_NAME, { path: "/" });
        cookies.delete(DIRECTUS_ACCESS_COOKIE_NAME, { path: "/" });
        cookies.delete(REMEMBER_COOKIE_NAME, { path: "/" });
    } catch {
        cookies.set(DIRECTUS_REFRESH_COOKIE_NAME, "", {
            ...getCookieOptions({
                requestUrl: url,
            }),
            maxAge: 0,
        });
        cookies.set(DIRECTUS_ACCESS_COOKIE_NAME, "", {
            ...getCookieOptions({
                requestUrl: url,
            }),
            maxAge: 0,
        });
        cookies.set(REMEMBER_COOKIE_NAME, "", {
            ...getCookieOptions({
                requestUrl: url,
            }),
            maxAge: 0,
        });
    }
}

export async function POST(context: APIContext): Promise<Response> {
    const { request, cookies, url } = context;

    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
        return json(
            { ok: false, message: i18n(I18nKey.interactionApiIllegalOrigin) },
            { status: 403 },
        );
    }

    const csrfDenied = assertCsrfToken(context);
    if (csrfDenied) return csrfDenied;

    const refreshToken = cookies.get(DIRECTUS_REFRESH_COOKIE_NAME)?.value || "";

    await logoutWithRefreshToken(refreshToken);

    clearAuthCookie(context);
    return json({ ok: true });
}
