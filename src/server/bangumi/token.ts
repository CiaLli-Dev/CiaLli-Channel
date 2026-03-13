import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from "node:crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PAYLOAD_VERSION = "v1";

let cachedKey: Buffer | null = null;

function readKeyMaterial(): Buffer {
    if (cachedKey) {
        return cachedKey;
    }
    const raw =
        String(process.env.BANGUMI_TOKEN_ENCRYPTION_KEY || "").trim() ||
        String(import.meta.env.BANGUMI_TOKEN_ENCRYPTION_KEY || "").trim();
    if (!raw) {
        throw new Error("BANGUMI_TOKEN_ENCRYPTION_KEY is required");
    }
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
        throw new Error(
            "BANGUMI_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key",
        );
    }
    cachedKey = key;
    return key;
}

/**
 * 对 Bangumi Access Token 进行对称加密后再落库。
 */
export function encryptBangumiAccessToken(token: string): string {
    const normalized = String(token || "").trim();
    if (!normalized) {
        throw new Error("Bangumi access token is empty");
    }
    const key = readKeyMaterial();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(normalized, "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, encrypted]).toString("base64");
    return `${PAYLOAD_VERSION}:${packed}`;
}

/**
 * 解密数据库中的 Bangumi Access Token，失败时返回 null。
 */
export function decryptBangumiAccessToken(
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

/**
 * 仅用于缓存键，避免把明文 token 写入日志或缓存 key。
 */
export function hashBangumiAccessToken(
    token: string | null | undefined,
): string {
    const normalized = String(token || "").trim();
    if (!normalized) {
        return "none";
    }
    return createHash("sha256").update(normalized).digest("hex").slice(0, 20);
}
