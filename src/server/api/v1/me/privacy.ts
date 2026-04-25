import type { APIContext } from "astro";

import {
    handleMyPermissions,
    handleMyPrivacy,
} from "@/server/application/me/privacy.service";

import type { AppAccess } from "../shared/types";

export async function handleMePrivacy(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    return await handleMyPrivacy(context, access);
}

export async function handleMePermissions(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    return await handleMyPermissions(context, access);
}
