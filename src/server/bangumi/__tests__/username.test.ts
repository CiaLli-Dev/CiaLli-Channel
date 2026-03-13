import { describe, expect, it } from "vitest";

import { normalizeBangumiId } from "@/server/bangumi/username";

describe("normalizeBangumiId", () => {
    it("accepts numeric id", () => {
        expect(normalizeBangumiId("914320")).toBe("914320");
    });

    it("rejects username and profile url", () => {
        expect(normalizeBangumiId("alice")).toBe("");
        expect(normalizeBangumiId("https://bangumi.tv/user/914320")).toBe("");
        expect(normalizeBangumiId("@alice")).toBe("");
        expect(normalizeBangumiId("/user/914320")).toBe("");
    });
});
