import type { APIContext } from "astro";

import { fail, ok } from "@/server/api/response";
import { parseJsonBody } from "@/server/api/utils";
import { enqueueAndTriggerArticleSummaryJob } from "@/server/ai-summary/dispatch";
import { assertInternalAiSummaryRequest } from "@/server/ai-summary/internal-auth";
import { runWithDirectusServiceAccess } from "@/server/directus/client";

function readArticleId(body: unknown): string {
    if (!body || typeof body !== "object") {
        return "";
    }
    return String((body as { article_id?: unknown }).article_id || "").trim();
}

export async function POST(context: APIContext): Promise<Response> {
    const denied = assertInternalAiSummaryRequest(context);
    if (denied) {
        return denied;
    }
    const body = await parseJsonBody(context.request);
    const articleId = readArticleId(body);
    if (!articleId) {
        return fail("缺少 article_id", 400);
    }

    const result = await runWithDirectusServiceAccess(async () =>
        enqueueAndTriggerArticleSummaryJob({
            articleId,
            kind: "on_publish",
            force:
                typeof body === "object" &&
                body !== null &&
                (body as { force?: unknown }).force === true,
        }),
    );
    return ok(result);
}
