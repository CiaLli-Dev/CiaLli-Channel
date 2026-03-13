import { getRandomValues } from "node:crypto";

import type { DirectusSchema } from "@/server/directus/schema";
import { conflict } from "@/server/api/errors";

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHORT_ID_PREFIX = "CL";
const SHORT_ID_LENGTH = 10;

const SHORT_ID_RE = /^CL[0-9a-zA-Z]{10}$/;
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 生成短 ID：格式为 `CL` + 10 位 base62 字符。 */
export function generateShortId(): string {
    const bytes = new Uint8Array(SHORT_ID_LENGTH);
    getRandomValues(bytes);
    let result = SHORT_ID_PREFIX;
    for (let i = 0; i < SHORT_ID_LENGTH; i++) {
        result += BASE62[bytes[i] % BASE62.length];
    }
    return result;
}

/** 判断 `input` 是否符合短 ID 格式（`CL` + 10 位 base62）。 */
export function isShortId(input: string): boolean {
    return SHORT_ID_RE.test(input);
}

/** 判断 `input` 是否为合法 UUID。 */
export function isUuid(input: string): boolean {
    return UUID_RE.test(input);
}

/** 判断错误是否为数据库唯一约束冲突 */
export function isUniqueConstraintError(error: unknown): boolean {
    const message = String(error).toLowerCase();
    return (
        message.includes("unique") ||
        message.includes("duplicate") ||
        message.includes("not_unique")
    );
}

/**
 * 创建记录并自动生成 short_id，内置碰撞重试。
 *
 * 碰撞时自动重试并记录日志；重试耗尽后抛出 409 错误。
 */
export async function createWithShortId<K extends keyof DirectusSchema>(
    collection: K,
    payload: Partial<DirectusSchema[K][number]>,
    createFn: (
        col: K,
        data: Partial<DirectusSchema[K][number]>,
    ) => Promise<DirectusSchema[K][number]>,
    maxRetries = 3,
): Promise<DirectusSchema[K][number]> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await createFn(collection, {
                ...payload,
                short_id: generateShortId(),
            } as Partial<DirectusSchema[K][number]>);
        } catch (error) {
            if (isUniqueConstraintError(error) && attempt < maxRetries - 1) {
                console.warn(
                    `[short-id] 碰撞重试 ${attempt + 1}/${maxRetries}，集合=${String(collection)}`,
                );
                continue;
            }
            if (isUniqueConstraintError(error)) {
                console.error(
                    `[short-id] 碰撞重试耗尽，集合=${String(collection)}`,
                );
                throw conflict("SHORT_ID_COLLISION", "短 ID 碰撞，请重试");
            }
            throw error;
        }
    }
    /* istanbul ignore next -- 逻辑上不可达 */
    throw conflict("SHORT_ID_COLLISION", "短 ID 碰撞，请重试");
}
