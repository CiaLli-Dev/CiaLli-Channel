import type { APIContext } from "astro";

import { getPublicSiteSettings } from "@/server/site-settings/service";
import { fail, ok } from "@/server/api/response";

export async function handlePublicSiteSettings(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }
    if (segments.length !== 2) {
        return fail("未找到接口", 404);
    }
    const data = await getPublicSiteSettings();
    return ok({
        settings: data.settings,
        updated_at: data.updatedAt,
    });
}
