import type { APIContext } from "astro";

import { handleAdminRegistrationRequests as handleAdminRegistrationRequestsService } from "@/server/application/admin/registration-requests.service";

export async function handleAdminRegistrationRequests(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    return await handleAdminRegistrationRequestsService(context, segments);
}
