import type { APIContext } from "astro";

import { getAppAccessContext } from "@/server/auth/acl";
import { getSessionUser } from "@/server/auth/session";
import { buildDirectusAssetUrl } from "@/server/directus-auth";

export type AuthenticatedViewer =
    | {
          ok: true;
          payload: {
              ok: true;
              user: {
                  id: string;
                  email: string;
                  name: string;
                  username?: string;
                  avatarUrl?: string;
              };
              is_admin: boolean;
          };
      }
    | {
          ok: false;
          reason: "not_logged_in" | "load_failed";
      };

export async function getAuthenticatedViewer(
    context: APIContext,
): Promise<AuthenticatedViewer> {
    const user = await getSessionUser(context);
    if (!user) {
        return {
            ok: false,
            reason: "not_logged_in",
        };
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

        return {
            ok: true,
            payload: {
                ok: true,
                user: {
                    id: user.id,
                    email: user.email,
                    name,
                    username: username || undefined,
                    avatarUrl: avatarUrl || undefined,
                },
                is_admin: access.isAdmin,
            },
        };
    } catch {
        return {
            ok: false,
            reason: "load_failed",
        };
    }
}
