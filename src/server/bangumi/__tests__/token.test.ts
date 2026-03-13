import { describe, expect, it } from "vitest";

import {
    decryptBangumiAccessToken,
    encryptBangumiAccessToken,
    hashBangumiAccessToken,
} from "@/server/bangumi/token";

describe("bangumi token crypto", () => {
    it("encrypt/decrypt roundtrip", () => {
        const plain = "bgm_pat_test_token_123";
        const encrypted = encryptBangumiAccessToken(plain);

        expect(encrypted).not.toBe(plain);
        expect(encrypted.startsWith("v1:")).toBe(true);
        expect(decryptBangumiAccessToken(encrypted)).toBe(plain);
    });

    it("invalid payload returns null", () => {
        expect(decryptBangumiAccessToken("not-valid")).toBeNull();
        expect(decryptBangumiAccessToken("v1:xxxx")).toBeNull();
    });

    it("hash is stable and does not expose raw token", () => {
        const token = "bgm_pat_secret_value";
        const hash1 = hashBangumiAccessToken(token);
        const hash2 = hashBangumiAccessToken(token);

        expect(hash1).toBe(hash2);
        expect(hash1).not.toContain(token);
        expect(hash1.length).toBeGreaterThan(0);
    });
});
