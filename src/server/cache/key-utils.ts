import { createHash } from "node:crypto";

/** 将参数对象哈希为 16 字符十六进制字符串，用于构建缓存键 */
export function hashParams(params: Record<string, unknown>): string {
    const sorted = JSON.stringify(params, Object.keys(params).sort());
    return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}
