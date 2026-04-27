import { describe, expect, it } from "vitest";

import { getCookieOptions } from "@/server/directus-auth";

describe("Directus auth cookie options", () => {
    it("allows login cookies over an explicit HTTP public entry", () => {
        expect(
            getCookieOptions({
                requestUrl: new URL("http://34.97.138.58/api/auth/login"),
            }).secure,
        ).toBe(false);
    });

    it("keeps login cookies secure over HTTPS", () => {
        expect(
            getCookieOptions({
                requestUrl: new URL(
                    "https://demo.ciallichannel.com/api/auth/login",
                ),
            }).secure,
        ).toBe(true);
    });
});
