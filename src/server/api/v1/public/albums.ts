import type { APIContext } from "astro";

import { handlePublicAlbumsRoute } from "@/server/application/public/albums.service";

export async function handlePublicAlbums(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handlePublicAlbumsRoute(context, segments);
}
