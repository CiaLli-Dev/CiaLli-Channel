import { describe, expect, it } from "vitest";

import {
    decryptSecretValue,
    encryptSecretValue,
} from "@/server/crypto/secret-box";

describe("secret-box", () => {
    it("encrypts and decrypts secret values without exposing plaintext", () => {
        const secret = "sk-test-secret-value";
        const encrypted = encryptSecretValue(secret);

        expect(encrypted).not.toContain(secret);
        expect(encrypted.startsWith("v1:")).toBe(true);
        expect(decryptSecretValue(encrypted)).toBe(secret);
    });

    it("returns null for invalid encrypted payloads", () => {
        expect(decryptSecretValue("")).toBeNull();
        expect(decryptSecretValue("not-valid")).toBeNull();
        expect(decryptSecretValue("v1:bad-payload")).toBeNull();
    });
});
