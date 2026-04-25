import type { APIContext } from "astro";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getAuthenticatedViewer } from "@/server/application/auth/session.service";

const AUTH_NO_STORE = "private, no-store";
const OPTIONAL_AUTH_QUERY_KEYS = ["optional", "probe", "silent"] as const;

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
        const isOptionalAuthProbe = OPTIONAL_AUTH_QUERY_KEYS.some((key) => {
            const value = context.url.searchParams.get(key);
            return value === "1" || value === "true";
        });
        if (isOptionalAuthProbe) {
            return json({
                ok: false,
                message: i18n(I18nKey.interactionApiAuthNotLoggedIn),
            });
        }
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
