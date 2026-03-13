import type { APIContext } from "astro";
import { handleMyArticles } from "@/server/application/me/articles.service";

import type { AppAccess } from "../shared";

export async function handleMeArticles(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyArticles(context, access, segments);
}
