import type { APIContext } from "astro";

import { handlePublicFriendsRoute } from "@/server/application/public/friends.service";

export async function handlePublicFriends(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handlePublicFriendsRoute(context, segments);
}
