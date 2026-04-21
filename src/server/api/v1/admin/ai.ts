import type { APIContext } from "astro";

import { handleAdminAi as handleAdminAiService } from "@/server/application/admin/ai-settings.service";

export async function handleAdminAi(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handleAdminAiService(context, segments);
}
