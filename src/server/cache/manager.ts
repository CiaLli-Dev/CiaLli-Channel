/**
 * 两级缓存管理器
 *
 * L1: 进程内 Map（按域隔离，FIFO 淘汰）
 * L2: Upstash Redis 官方 SDK（可选，不可用时静默降级）
 *
 * 域版本号机制：每个域维护 cache:v1:<domain>:__ver__ 计数器，
 * 完整键 = cache:v1:<domain>:v<ver>:<key>。invalidateByDomain() 递增版本号，
 * 旧键自然过期，无需 scan。
 */
import { prefixRedisKey } from "@/server/upstash/namespace";
import { getUpstashRedisClient } from "@/server/upstash/redis";

import type { CacheDomain, CacheMetrics, CacheStrategy } from "./types";

// ---------------------------------------------------------------------------
// 策略配置表
// ---------------------------------------------------------------------------

const STRATEGIES: Record<CacheDomain, CacheStrategy> = {
    author: { l1TtlMs: 5 * 60_000, l2TtlMs: 10 * 60_000, l1MaxEntries: 500 },
    "site-settings": {
        l1TtlMs: 30 * 60_000,
        l2TtlMs: 60 * 60_000,
        l1MaxEntries: 5,
    },
    "banner-images": {
        l1TtlMs: 30 * 60_000,
        l2TtlMs: 60 * 60_000,
        l1MaxEntries: 5,
    },
    sidebar: {
        l1TtlMs: 10 * 60_000,
        l2TtlMs: 30 * 60_000,
        l1MaxEntries: 10,
    },
    "profile-viewer": {
        l1TtlMs: 60_000,
        l2TtlMs: 2 * 60_000,
        l1MaxEntries: 200,
    },
    "article-list": {
        l1TtlMs: 5 * 60_000,
        l2TtlMs: 15 * 60_000,
        l1MaxEntries: 100,
    },
    "article-taxonomy": {
        l1TtlMs: 30 * 60_000,
        l2TtlMs: 60 * 60_000,
        l1MaxEntries: 20,
    },
    "article-detail": {
        l1TtlMs: 2 * 60_000,
        l2TtlMs: 10 * 60_000,
        l1MaxEntries: 200,
    },
    "article-public": {
        l1TtlMs: 60_000,
        l2TtlMs: 5 * 60_000,
        l1MaxEntries: 300,
    },
    "article-interaction": {
        l1TtlMs: 30_000,
        l2TtlMs: 30_000,
        l1MaxEntries: 600,
    },
    "diary-interaction": {
        l1TtlMs: 30_000,
        l2TtlMs: 30_000,
        l1MaxEntries: 600,
    },
    "diary-list": {
        l1TtlMs: 30_000,
        l2TtlMs: 2 * 60_000,
        l1MaxEntries: 50,
    },
    "diary-detail": {
        l1TtlMs: 2 * 60_000,
        l2TtlMs: 10 * 60_000,
        l1MaxEntries: 100,
    },
    "mixed-feed": {
        l1TtlMs: 5 * 60_000,
        l2TtlMs: 15 * 60_000,
        l1MaxEntries: 80,
    },
    "album-list": {
        l1TtlMs: 30_000,
        l2TtlMs: 2 * 60_000,
        l1MaxEntries: 50,
    },
    "album-detail": {
        l1TtlMs: 2 * 60_000,
        l2TtlMs: 10 * 60_000,
        l1MaxEntries: 100,
    },
    "bangumi-list": {
        l1TtlMs: 10 * 60_000,
        l2TtlMs: 30 * 60_000,
        l1MaxEntries: 120,
    },
    "user-home": {
        l1TtlMs: 2 * 60_000,
        l2TtlMs: 5 * 60_000,
        l1MaxEntries: 50,
    },
    "session-user": {
        l1TtlMs: 60_000,
        l2TtlMs: 60_000,
        l1MaxEntries: 500,
    },
    markdown: {
        l1TtlMs: 5 * 60_000,
        l2TtlMs: 60 * 60_000,
        l1MaxEntries: 200,
    },
};

const LINKED_DOMAIN_INVALIDATIONS: Partial<Record<CacheDomain, CacheDomain[]>> =
    {};

// ---------------------------------------------------------------------------
// L1 — 进程内缓存
// ---------------------------------------------------------------------------

type L1Entry = { value: string; expiresAt: number };

const l1Stores = new Map<CacheDomain, Map<string, L1Entry>>();

function getL1Store(domain: CacheDomain): Map<string, L1Entry> {
    let store = l1Stores.get(domain);
    if (!store) {
        store = new Map();
        l1Stores.set(domain, store);
    }
    return store;
}

function l1Get(domain: CacheDomain, key: string): string | null {
    const store = getL1Store(domain);
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
    }
    return entry.value;
}

/** L1 最大值大小限制：markdown 域超大 HTML 仅存 L2 */
const L1_MAX_VALUE_SIZE: Partial<Record<CacheDomain, number>> = {
    markdown: 50 * 1024, // 50KB
};

function l1Set(domain: CacheDomain, key: string, value: string): void {
    const strategy = STRATEGIES[domain];
    if (strategy.l1TtlMs <= 0) return;

    const maxSize = L1_MAX_VALUE_SIZE[domain];
    if (maxSize !== undefined && value.length > maxSize) return;

    const store = getL1Store(domain);

    // FIFO 淘汰：超出上限时删除最早插入的条目
    if (store.size >= strategy.l1MaxEntries && !store.has(key)) {
        const firstKey = store.keys().next().value;
        if (firstKey !== undefined) {
            store.delete(firstKey);
        }
    }

    store.set(key, {
        value,
        expiresAt: Date.now() + strategy.l1TtlMs,
    });
}

function l1Delete(domain: CacheDomain, key: string): void {
    getL1Store(domain).delete(key);
}

function l1Clear(domain: CacheDomain): void {
    getL1Store(domain).clear();
}

// ---------------------------------------------------------------------------
// L2 — Upstash Redis
// ---------------------------------------------------------------------------

async function l2Get(
    domain: CacheDomain,
    fullKey: string,
): Promise<string | null> {
    const strategy = STRATEGIES[domain];
    if (strategy.l2TtlMs <= 0) return null;
    const redis = getUpstashRedisClient({
        automaticDeserialization: false,
    });
    if (!redis) {
        return null;
    }
    const redisKey = prefixRedisKey(fullKey);
    try {
        const value = await redis.get<string>(redisKey);
        if (value === null) {
            return null;
        }
        return typeof value === "string" ? value : String(value);
    } catch {
        return null;
    }
}

async function l2Set(
    domain: CacheDomain,
    fullKey: string,
    value: string,
): Promise<void> {
    const strategy = STRATEGIES[domain];
    if (strategy.l2TtlMs <= 0) return;
    const ttlSeconds = Math.ceil(strategy.l2TtlMs / 1000);
    const redis = getUpstashRedisClient({
        automaticDeserialization: false,
    });
    if (!redis) {
        return;
    }
    const redisKey = prefixRedisKey(fullKey);
    try {
        await redis.set(redisKey, value, { ex: ttlSeconds });
    } catch {
        // Redis 不可用时静默降级到仅 L1
    }
}

async function l2Delete(fullKey: string): Promise<void> {
    const redis = getUpstashRedisClient({
        automaticDeserialization: false,
    });
    if (!redis) {
        return;
    }
    const redisKey = prefixRedisKey(fullKey);
    try {
        await redis.del(redisKey);
    } catch {
        // Redis 不可用时静默降级到仅 L1
    }
}

// ---------------------------------------------------------------------------
// 域版本号
// ---------------------------------------------------------------------------

type LocalDomainVersionEntry = {
    version: number;
    cachedAt: number;
};

const localVersions = new Map<CacheDomain, LocalDomainVersionEntry>();
const DOMAIN_VERSION_REFRESH_MS = 5_000;

function versionKey(domain: CacheDomain): string {
    return `cache:v1:${domain}:__ver__`;
}

async function getDomainVersion(domain: CacheDomain): Promise<number> {
    // 多实例场景下，域版本号不能长期驻留在本地缓存，否则会错过其他实例的失效操作。
    const local = localVersions.get(domain);
    if (local && Date.now() - local.cachedAt <= DOMAIN_VERSION_REFRESH_MS) {
        return local.version;
    }

    const redis = getUpstashRedisClient({
        automaticDeserialization: false,
    });
    let ver = 0;
    if (redis) {
        const redisKey = prefixRedisKey(versionKey(domain));
        try {
            const value = await redis.get<string>(redisKey);
            ver = value !== null ? parseInt(String(value), 10) : 0;
        } catch {
            ver = 0;
        }
    }
    const version = Number.isFinite(ver) ? ver : 0;
    localVersions.set(domain, {
        version,
        cachedAt: Date.now(),
    });
    return version;
}

async function incrementDomainVersion(domain: CacheDomain): Promise<number> {
    const redis = getUpstashRedisClient({
        automaticDeserialization: false,
    });
    let ver = 1;
    if (redis) {
        const redisKey = prefixRedisKey(versionKey(domain));
        try {
            ver = await redis.incr(redisKey);
        } catch {
            ver = 1;
        }
    }
    const version = Number.isFinite(ver) ? ver : 1;
    localVersions.set(domain, {
        version,
        cachedAt: Date.now(),
    });
    return version;
}

function buildFullKey(domain: CacheDomain, ver: number, key: string): string {
    return `cache:v1:${domain}:v${ver}:${key}`;
}

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------

const metricsMap = new Map<CacheDomain, CacheMetrics>();

function getMetrics(domain: CacheDomain): CacheMetrics {
    let m = metricsMap.get(domain);
    if (!m) {
        m = {
            l1Hits: 0,
            l1Misses: 0,
            l2Hits: 0,
            l2Misses: 0,
            sets: 0,
            invalidations: 0,
        };
        metricsMap.set(domain, m);
    }
    return m;
}

// 定期输出指标
let metricsTimerStarted = false;

function ensureMetricsTimer(): void {
    if (metricsTimerStarted) return;
    metricsTimerStarted = true;
    setInterval(
        () => {
            for (const [domain, m] of metricsMap.entries()) {
                const total =
                    m.l1Hits + m.l1Misses + m.l2Hits + m.l2Misses + m.sets;
                if (total === 0) continue;
                console.info(
                    `[cache] ${domain}: L1=${m.l1Hits}/${m.l1Hits + m.l1Misses} L2=${m.l2Hits}/${m.l2Hits + m.l2Misses} sets=${m.sets} inv=${m.invalidations}`,
                );
            }
        },
        5 * 60 * 1000,
    ).unref();
}

// ---------------------------------------------------------------------------
// CacheManager 公开 API
// ---------------------------------------------------------------------------

export const cacheManager = {
    /**
     * 从缓存中获取值。
     * L1 命中 → 直接返回；L1 未命中 → 尝试 L2 → L2 命中则回填 L1。
     */
    async get<T>(domain: CacheDomain, key: string): Promise<T | null> {
        ensureMetricsTimer();
        const m = getMetrics(domain);

        const ver = await getDomainVersion(domain);
        const fullKey = buildFullKey(domain, ver, key);

        // L1
        const l1Value = l1Get(domain, fullKey);
        if (l1Value !== null) {
            m.l1Hits++;
            try {
                return JSON.parse(l1Value) as T;
            } catch {
                l1Delete(domain, fullKey);
            }
        }
        m.l1Misses++;

        // L2
        const l2Value = await l2Get(domain, fullKey);
        if (l2Value !== null) {
            m.l2Hits++;
            // 回填 L1
            l1Set(domain, fullKey, l2Value);
            try {
                return JSON.parse(l2Value) as T;
            } catch {
                return null;
            }
        }
        m.l2Misses++;

        return null;
    },

    /** 写入缓存（同时写 L1 + L2） */
    async set<T>(domain: CacheDomain, key: string, value: T): Promise<void> {
        const m = getMetrics(domain);
        m.sets++;

        const ver = await getDomainVersion(domain);
        const fullKey = buildFullKey(domain, ver, key);
        const serialized = JSON.stringify(value);

        l1Set(domain, fullKey, serialized);
        await l2Set(domain, fullKey, serialized);
    },

    /** 失效单条缓存 */
    async invalidate(domain: CacheDomain, key: string): Promise<void> {
        const m = getMetrics(domain);
        m.invalidations++;

        const ver = await getDomainVersion(domain);
        const fullKey = buildFullKey(domain, ver, key);
        l1Delete(domain, fullKey);
        await l2Delete(fullKey);
    },

    /** 失效整个域——递增域版本号，旧键自然过期 */
    async invalidateByDomain(domain: CacheDomain): Promise<void> {
        const m = getMetrics(domain);
        m.invalidations++;

        l1Clear(domain);
        await incrementDomainVersion(domain);

        const linkedDomains = LINKED_DOMAIN_INVALIDATIONS[domain] || [];
        for (const linkedDomain of linkedDomains) {
            const linkedMetrics = getMetrics(linkedDomain);
            linkedMetrics.invalidations++;
            l1Clear(linkedDomain);
            await incrementDomainVersion(linkedDomain);
        }
    },

    /** 获取指标快照 */
    getMetrics(domain: CacheDomain): Readonly<CacheMetrics> {
        return { ...getMetrics(domain) };
    },
};
