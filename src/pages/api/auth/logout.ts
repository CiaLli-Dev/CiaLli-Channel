import type { APIContext } from "astro";
import { logoutWithRefreshToken } from "@/server/application/auth/logout.service";
import {
    DIRECTUS_ACCESS_COOKIE_NAME,
    DIRECTUS_REFRESH_COOKIE_NAME,
    getCookieOptions,
    REMEMBER_COOKIE_NAME,
} from "@/server/directus-auth";
import { assertCsrfToken } from "@/server/security/csrf";
import { assertSameOrigin } from "@/server/security/origin";

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
    const { cookies } = context;

    const sameOriginDenied = assertSameOrigin(context);
    if (sameOriginDenied) {
        return sameOriginDenied;
    }

    const csrfDenied = assertCsrfToken(context);
    if (csrfDenied) return csrfDenied;

    const refreshToken = cookies.get(DIRECTUS_REFRESH_COOKIE_NAME)?.value || "";

    await logoutWithRefreshToken(refreshToken);

    clearAuthCookie(context);
    return json({ ok: true });
}
