import type { APIContext } from "astro";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { getAppAccessContext } from "@/server/auth/acl";
import { getSessionUser } from "@/server/auth/session";
import { buildDirectusAssetUrl } from "@/server/directus-auth";

export const prerender = false;
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
    const user = await getSessionUser(context);
    if (!user) {
        return json(
            { ok: false, message: i18n(I18nKey.interactionApiAuthNotLoggedIn) },
            { status: 401 },
        );
    }

    try {
        const access = await getAppAccessContext(user);
        const profile = access.profile;
        const username = String(profile.username || "").trim();
        const displayName = String(profile.display_name || "").trim();
        const name =
            displayName || username || user.name || user.email || "Member";
        const avatarUrl = profile.avatar_file
            ? buildDirectusAssetUrl(profile.avatar_file, {
                  width: 128,
                  height: 128,
                  fit: "cover",
              })
            : user.avatarUrl;

        return json({
            ok: true,
            user: {
                id: user.id,
                email: user.email,
                name,
                username: username || undefined,
                avatarUrl: avatarUrl || undefined,
            },
            is_admin: access.isAdmin,
        });
    } catch (error) {
        void error;
        return json(
            {
                ok: false,
                message: i18n(I18nKey.interactionApiAuthGetUserFailed),
            },
            { status: 500 },
        );
    }
}
