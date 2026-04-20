/**
 * 分级速率限制
 *
 * 按请求类别独立计数，每个分类拥有独立的 Ratelimit 实例。
 * 生产环境使用 Upstash Redis，开发环境使用内存兜底。
 */
import { Ratelimit } from "@upstash/ratelimit";

import { internal } from "@/server/api/errors";
import { prefixRedisKey } from "@/server/upstash/namespace";
import {
    getUpstashRedisClient,
    getUpstashRedisConfig,
} from "@/server/upstash/redis";

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

// ---- Upstash 实例缓存（按分类懒创建） ----

const instanceCache = new Map<RateLimitCategory, Ratelimit>();

function getIsProductionRuntime(): boolean {
    return import.meta.env.PROD || process.env.NODE_ENV === "production";
}

function getInstance(category: RateLimitCategory): Ratelimit {
    const cached = instanceCache.get(category);
    if (cached) return cached;

    const redis = getUpstashRedisClient();
    if (!redis) throw internal("Upstash 限流服务未配置");
    const cat = CATEGORY_CONFIG[category];

    const instance = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(cat.limit, `${cat.windowSeconds} s`),
        analytics: false,
        prefix: prefixRedisKey(cat.prefix),
    });
    instanceCache.set(category, instance);
    return instance;
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
    const hasUpstash = Boolean(getUpstashRedisConfig());
    const isProduction = getIsProductionRuntime();

    if (!hasUpstash) {
        if (isProduction) throw internal("Upstash 限流服务未配置");
        const windowMs = cat.windowSeconds * 1000;
        return memoryRateLimit(`${cat.prefix}:${cleanIp}`, cat.limit, windowMs);
    }

    const instance = getInstance(category);
    const result = await instance.limit(`ip:${cleanIp}`);
    const resetAt =
        typeof result.reset === "number"
            ? result.reset
            : Date.now() + cat.windowSeconds * 1000;

    return {
        ok: Boolean(result.success),
        remaining: Number(result.remaining ?? 0),
        resetAt,
    };
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
