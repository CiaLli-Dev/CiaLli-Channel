import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PAYLOAD_VERSION = "v1";
const SECRET_KEY_ENV = "BANGUMI_TOKEN_ENCRYPTION_KEY";

let cachedKey: Buffer | null = null;

function readKeyMaterial(): Buffer {
    if (cachedKey) {
        return cachedKey;
    }
    const raw =
        String(process.env[SECRET_KEY_ENV] || "").trim() ||
        String(import.meta.env[SECRET_KEY_ENV] || "").trim();
    if (!raw) {
        throw new Error(`${SECRET_KEY_ENV} is required`);
    }
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
        throw new Error(`${SECRET_KEY_ENV} must be base64-encoded 32-byte key`);
    }
    cachedKey = key;
    return key;
}

export function encryptSecretValue(secret: string): string {
    const normalized = String(secret || "").trim();
    if (!normalized) {
        throw new Error("secret value is empty");
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, readKeyMaterial(), iv);
    const encrypted = Buffer.concat([
        cipher.update(normalized, "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, encrypted]).toString("base64");
    return `${PAYLOAD_VERSION}:${packed}`;
}

export function decryptSecretValue(
    encryptedValue: string | null | undefined,
): string | null {
    const payload = String(encryptedValue || "").trim();
    if (!payload) {
        return null;
    }
    const [version, base64Data] = payload.split(":", 2);
    if (version !== PAYLOAD_VERSION || !base64Data) {
        return null;
    }

    try {
        const data = Buffer.from(base64Data, "base64");
        if (data.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
            return null;
        }
        const iv = data.subarray(0, IV_LENGTH);
        const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
        const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
        const decipher = createDecipheriv(
            ENCRYPTION_ALGORITHM,
            readKeyMaterial(),
            iv,
        );
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final(),
        ]).toString("utf8");
        return decrypted || null;
    } catch {
        return null;
    }
}

export function safeCompareSecret(
    actual: string | null | undefined,
    expected: string | null | undefined,
): boolean {
    const actualValue = String(actual || "");
    const expectedValue = String(expected || "");
    if (!actualValue || !expectedValue) {
        return false;
    }
    const actualBuffer = Buffer.from(actualValue);
    const expectedBuffer = Buffer.from(expectedValue);
    if (actualBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return timingSafeEqual(actualBuffer, expectedBuffer);
}
