import type { APIContext } from "astro";

import { fail } from "@/server/api/response";
import { safeCompareSecret } from "@/server/crypto/secret-box";

export const AI_SUMMARY_INTERNAL_SECRET_HEADER = "x-internal-secret";

function readInternalSecret(): string {
    return (
        String(process.env.AI_SUMMARY_INTERNAL_SECRET || "").trim() ||
        String(import.meta.env.AI_SUMMARY_INTERNAL_SECRET || "").trim()
    );
}

export function verifyInternalSecretHeader(headers: Headers): boolean {
    return safeCompareSecret(
        headers.get(AI_SUMMARY_INTERNAL_SECRET_HEADER),
        readInternalSecret(),
    );
}

export function assertInternalAiSummaryRequest(
    context: APIContext,
): Response | null {
    if (verifyInternalSecretHeader(context.request.headers)) {
        return null;
    }
    return fail("内部接口鉴权失败", 401);
}
