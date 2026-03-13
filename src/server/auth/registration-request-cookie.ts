import type { APIContext } from "astro";

import { getCookieOptions } from "@/server/directus-auth";

export const REGISTRATION_REQUEST_COOKIE_NAME = "dc_registration_request";
export const REGISTRATION_REQUEST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeRegistrationRequestId(value: unknown): string | null {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return null;
    }
    return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function setRegistrationRequestCookie(
    context: APIContext,
    requestId: string,
): void {
    const normalized = normalizeRegistrationRequestId(requestId);
    if (!normalized) {
        return;
    }
    context.cookies.set(
        REGISTRATION_REQUEST_COOKIE_NAME,
        normalized,
        getCookieOptions({
            requestUrl: context.url,
            maxAge: REGISTRATION_REQUEST_COOKIE_MAX_AGE_SECONDS,
        }),
    );
}

export function clearRegistrationRequestCookie(context: APIContext): void {
    try {
        context.cookies.delete(REGISTRATION_REQUEST_COOKIE_NAME, { path: "/" });
    } catch {
        context.cookies.set(REGISTRATION_REQUEST_COOKIE_NAME, "", {
            ...getCookieOptions({
                requestUrl: context.url,
            }),
            maxAge: 0,
        });
    }
}
