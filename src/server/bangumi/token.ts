import { createHash } from "node:crypto";

import {
    decryptSecretValue,
    encryptSecretValue,
} from "@/server/crypto/secret-box";

/**
 * 对 Bangumi Access Token 进行对称加密后再落库。
 */
export function encryptBangumiAccessToken(token: string): string {
    return encryptSecretValue(token);
}

/**
 * 解密数据库中的 Bangumi Access Token，失败时返回 null。
 */
export function decryptBangumiAccessToken(
    encryptedValue: string | null | undefined,
): string | null {
    return decryptSecretValue(encryptedValue);
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
