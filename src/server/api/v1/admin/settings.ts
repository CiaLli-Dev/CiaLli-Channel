import type { APIContext } from "astro";

import { handleAdminSettings as handleAdminSettingsService } from "@/server/application/admin/settings.service";

export async function handleAdminSettings(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handleAdminSettingsService(context, segments);
}
