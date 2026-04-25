import type { APIContext } from "astro";

import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { fail, ok } from "@/server/api/response";
import { requireAdmin } from "@/server/api/v1/shared/auth";
import { AdminAiSettingsUpdateSchema } from "@/server/api/schemas";
import { invalidateSiteSettingsCache } from "@/server/site-settings/service";
import {
    buildPublicAiSettings,
    loadStoredAiSettings,
    saveAiSettingsPatch,
} from "@/server/ai-summary/config";
import { withUserRepositoryContext } from "@/server/repositories/directus/scope";

async function handleGet(): Promise<Response> {
    return ok({
        settings: buildPublicAiSettings(await loadStoredAiSettings()),
    });
}

async function handlePatch(context: APIContext): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminAiSettingsUpdateSchema, body);
    const settings = await saveAiSettingsPatch(input);
    await invalidateSiteSettingsCache();
    return ok({ settings });
}

export async function handleAdminAi(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    return await withUserRepositoryContext(required.accessToken, async () => {
        if (segments.length !== 2 || segments[1] !== "settings") {
            return fail("未找到接口", 404);
        }
        if (context.request.method === "GET") {
            return await handleGet();
        }
        if (context.request.method === "PATCH") {
            return await handlePatch(context);
        }
        return fail("方法不允许", 405);
    });
}
