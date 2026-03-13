import type { APIContext } from "astro";

import { handleAdminContent as handleAdminContentService } from "@/server/application/admin/content.service";

export async function handleAdminContent(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handleAdminContentService(context, segments);
}
