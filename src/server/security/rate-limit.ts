import { internal } from "@/server/api/errors";
import { prefixRedisKey } from "@/server/redis/namespace";
import { getRedisClient, getRedisConfig } from "@/server/redis/client";

/** 限流分类 */
export type RateLimitCategory =
    | "auth"
    | "registration-check"
    | "write"
    | "upload"
    | "comment"
    | "admin-write";

export type RateLimitResult = {
    ok: boolean;
    remaining: number;
    resetAt: number;
};

type CategoryConfig = {
    limit: number;
    /** 窗口时长（秒） */
    windowSeconds: number;
    prefix: string;
};

const CATEGORY_CONFIG: Record<RateLimitCategory, CategoryConfig> = {
    auth: { limit: 10, windowSeconds: 300, prefix: "rl:auth" },
    "registration-check": {
        limit: 20,
        windowSeconds: 60,
        prefix: "rl:registration-check",
    },
    write: { limit: 60, windowSeconds: 60, prefix: "rl:write" },
    upload: { limit: 60, windowSeconds: 60, prefix: "rl:upload" },
    comment: { limit: 15, windowSeconds: 60, prefix: "rl:comment" },
    "admin-write": {
        limit: 120,
        windowSeconds: 60,
        prefix: "rl:admin",
    },
};

function getIsProductionRuntime(): boolean {
    return import.meta.env.PROD || process.env.NODE_ENV === "production";
}

function buildRateLimitRedisKey(
    category: RateLimitCategory,
    cleanIp: string,
): string {
    return prefixRedisKey(`${CATEGORY_CONFIG[category].prefix}:ip:${cleanIp}`);
}

/**
 * 使用 Redis 固定窗口计数实现限流，
 * 返回是否超限、剩余额度与重置时间。
 */
async function redisRateLimit(
    cleanIp: string,
    category: RateLimitCategory,
): Promise<RateLimitResult> {
    const redis = getRedisClient();
    if (!redis) {
        throw internal("Redis 限流服务未配置");
    }

    const cat = CATEGORY_CONFIG[category];
    const key = buildRateLimitRedisKey(category, cleanIp);
    const { current, ttlSeconds } = await redis.incrementFixedWindow(
        key,
        cat.windowSeconds,
    );
    if (current <= 0) {
        throw internal("Redis 限流服务不可用");
    }
    const safeTtlSeconds = ttlSeconds > 0 ? ttlSeconds : cat.windowSeconds;

    return {
        ok: current <= cat.limit,
        remaining: Math.max(0, cat.limit - current),
        resetAt: Date.now() + safeTtlSeconds * 1000,
    };
}

// ---- 内存兜底（开发环境） ----

type MemoryRecord = { count: number; resetAt: number };
const memoryStore = new Map<string, MemoryRecord>();

function memoryRateLimit(
    key: string,
    limit: number,
    windowMs: number,
): RateLimitResult {
    const now = Date.now();
    const existing = memoryStore.get(key);
    if (!existing || existing.resetAt <= now) {
        memoryStore.set(key, { count: 1, resetAt: now + windowMs });
        return {
            ok: true,
            remaining: Math.max(0, limit - 1),
            resetAt: now + windowMs,
        };
    }
    if (existing.count >= limit) {
        return { ok: false, remaining: 0, resetAt: existing.resetAt };
    }
    existing.count += 1;
    return {
        ok: true,
        remaining: Math.max(0, limit - existing.count),
        resetAt: existing.resetAt,
    };
}

// ---- 公开 API ----

export async function applyRateLimit(
    ip: string,
    category: RateLimitCategory,
): Promise<RateLimitResult> {
    const cleanIp = String(ip || "unknown").trim() || "unknown";
    const cat = CATEGORY_CONFIG[category];
    const hasRedis = Boolean(getRedisConfig());
    const isProduction = getIsProductionRuntime();

    if (!hasRedis) {
        if (isProduction) throw internal("Redis 限流服务未配置");
        const windowMs = cat.windowSeconds * 1000;
        return memoryRateLimit(`${cat.prefix}:${cleanIp}`, cat.limit, windowMs);
    }

    return await redisRateLimit(cleanIp, category);
}

/** 构造 429 限流响应（含 Retry-After 头） */
export function rateLimitResponse(result: RateLimitResult): Response {
    const retryAfter = Math.max(
        1,
        Math.ceil((result.resetAt - Date.now()) / 1000),
    );
    return new Response(
        JSON.stringify({
            ok: false,
            error: {
                code: "RATE_LIMITED",
                message: "请求过于频繁，请稍后再试",
            },
        }),
        {
            status: 429,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Retry-After": String(retryAfter),
                "X-RateLimit-Remaining": "0",
            },
        },
    );
}
