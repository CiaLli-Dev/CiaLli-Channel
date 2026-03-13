import type { APIContext } from "astro";

import { handleMyProfile } from "@/server/application/me/profile.service";

import type { AppAccess } from "../shared";

export async function handleMeProfile(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    return await handleMyProfile(context, access);
}
