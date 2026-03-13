import { describe, expect, it } from "vitest";

import { UpdateProfileSchema } from "@/server/api/schemas/profile";

describe("UpdateProfileSchema", () => {
    it("省略 social_links 时不注入 null", () => {
        const result = UpdateProfileSchema.parse({
            display_name: "Alice",
        });

        expect(result.display_name).toBe("Alice");
        expect(result.social_links).toBeUndefined();
    });

    it("显式传 null 时允许清空 social_links", () => {
        const result = UpdateProfileSchema.parse({
            social_links: null,
        });

        expect(result.social_links).toBeNull();
    });
});
