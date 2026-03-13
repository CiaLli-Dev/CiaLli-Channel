/**
 * 浏览器端 Short ID 生成器
 *
 * 使用 Web Crypto API 生成 `CL` + 10 位 base62 字符串。
 * 此 ID 仅用于上传文件命名（如 `{shortId}-cover.jpg`、`{shortId}-1.jpg`），
 * 不用于数据库记录 ID。
 */

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHORT_ID_PREFIX = "CL";
const SHORT_ID_LENGTH = 10;

/** 在浏览器端生成 `CL` + 10 位 base62 字符串 */
export function generateClientShortId(): string {
    const bytes = new Uint8Array(SHORT_ID_LENGTH);
    crypto.getRandomValues(bytes);
    let result = SHORT_ID_PREFIX;
    for (let i = 0; i < SHORT_ID_LENGTH; i++) {
        result += BASE62[bytes[i] % BASE62.length];
    }
    return result;
}
