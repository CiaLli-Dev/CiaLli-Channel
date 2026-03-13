import type { APIContext } from "astro";

import { updateOne } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { UpdatePrivacySchema } from "@/server/api/schemas";

import type { AppAccess } from "../shared";

export async function handleMePrivacy(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        const profile = access.profile;
        return ok({
            privacy: {
                profile_public: profile.profile_public,
                show_articles_on_profile: profile.show_articles_on_profile,
                show_diaries_on_profile: profile.show_diaries_on_profile,
                show_albums_on_profile: profile.show_albums_on_profile,
                show_comments_on_profile: profile.show_comments_on_profile,
            },
        });
    }

    if (context.request.method === "PATCH") {
        const body = await parseJsonBody(context.request);
        const input = validateBody(UpdatePrivacySchema, body);
        const updated = await updateOne(
            "app_user_profiles",
            access.profile.id,
            {
                profile_public:
                    input.profile_public ?? access.profile.profile_public,
                show_articles_on_profile:
                    input.show_articles_on_profile ??
                    access.profile.show_articles_on_profile,
                show_diaries_on_profile:
                    input.show_diaries_on_profile ??
                    access.profile.show_diaries_on_profile,
                show_albums_on_profile:
                    input.show_albums_on_profile ??
                    access.profile.show_albums_on_profile,
                show_comments_on_profile:
                    input.show_comments_on_profile ??
                    access.profile.show_comments_on_profile,
            },
        );
        return ok({ privacy: updated });
    }

    return fail("方法不允许", 405);
}

export async function handleMePermissions(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }
    return ok({
        permissions: access.permissions,
        is_admin: access.isAdmin,
    });
}
