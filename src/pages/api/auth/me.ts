import type { APIContext } from "astro";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getAuthenticatedViewer } from "@/server/application/auth/session.service";

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

export async function GET(context: APIContext): Promise<Response> {
    const result = await getAuthenticatedViewer(context);
    if (!result.ok && result.reason === "not_logged_in") {
        return json(
            { ok: false, message: i18n(I18nKey.interactionApiAuthNotLoggedIn) },
            { status: 401 },
        );
    }
    if (!result.ok) {
        return json(
            {
                ok: false,
                message: i18n(I18nKey.interactionApiAuthGetUserFailed),
            },
            { status: 500 },
        );
    }

    return json(result.payload);
}
