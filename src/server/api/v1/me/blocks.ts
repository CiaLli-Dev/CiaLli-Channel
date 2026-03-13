import type { APIContext } from "astro";

import { handleMyBlocks } from "@/server/application/me/blocks.service";
import type { AppAccess } from "../shared";

export async function handleMeBlocks(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyBlocks(context, access, segments);
}
