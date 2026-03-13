import type { APIContext } from "astro";

import { handlePublicArticlesRoute } from "@/server/application/public/articles.service";

export async function handlePublicArticles(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handlePublicArticlesRoute(context, segments);
}
