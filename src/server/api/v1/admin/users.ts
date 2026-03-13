import type { APIContext } from "astro";

import { handleAdminUsers as handleAdminUsersService } from "@/server/application/admin/users.service";

export async function handleAdminUsers(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handleAdminUsersService(context, segments);
}
