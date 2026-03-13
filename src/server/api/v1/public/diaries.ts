import type { APIContext } from "astro";

import { handlePublicDiariesRoute } from "@/server/application/public/diaries.service";

export async function handlePublicDiaries(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handlePublicDiariesRoute(context, segments);
}
