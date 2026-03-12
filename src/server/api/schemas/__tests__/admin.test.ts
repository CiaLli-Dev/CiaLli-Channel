import { describe, expect, it } from "vitest";

import { AdminUpdateUserSchema } from "@/server/api/schemas/admin";

describe("AdminUpdateUserSchema", () => {
    it("省略 social_links 时不注入 null", () => {
        const result = AdminUpdateUserSchema.parse({
            email: "admin@example.com",
        });

        expect(result.email).toBe("admin@example.com");
        expect(result.social_links).toBeUndefined();
    });

    it("显式传 null 时允许清空 social_links", () => {
        const result = AdminUpdateUserSchema.parse({
            social_links: null,
        });

        expect(result.social_links).toBeNull();
    });
});
