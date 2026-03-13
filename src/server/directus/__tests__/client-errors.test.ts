import { describe, expect, it } from "vitest";

import { toDirectusError } from "@/server/directus/client-errors";

describe("toDirectusError", () => {
    it("非 Directus 错误会保留诊断细节", () => {
        const rootCause = new Error("connect timeout");
        Object.assign(rootCause, {
            code: "UND_ERR_CONNECT_TIMEOUT",
        });
        const error = new Error("fetch failed", {
            cause: rootCause,
        });

        const appError = toDirectusError(
            "读取集合 app_site_settings 列表",
            error,
            {
                scope: "public",
                targetHost: "cms.example.com",
                timeoutMs: 30_000,
            },
        );

        expect(appError.code).toBe("INTERNAL_ERROR");
        expect(appError.status).toBe(500);
        expect(appError.details).toMatchObject({
            action: "读取集合 app_site_settings 列表",
            scope: "public",
            targetHost: "cms.example.com",
            timeoutMs: 30_000,
            errorMessage: "fetch failed",
            causeMessage: "connect timeout",
            causeCode: "UND_ERR_CONNECT_TIMEOUT",
        });
    });
});
