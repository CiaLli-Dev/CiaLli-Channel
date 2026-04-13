import { createHash, randomUUID } from "node:crypto";

import type { DirectusAuthTokens } from "@/server/directus-auth";
import { prefixRedisKey } from "@/server/upstash/namespace";
import { getUpstashRedisClient } from "@/server/upstash/redis";

const DISTRIBUTED_REFRESH_KEY_PREFIX = "auth:refresh:v1";
const DISTRIBUTED_REFRESH_LOCK_TTL_SECONDS = 3;
const DISTRIBUTED_REFRESH_RESULT_TTL_SECONDS = 10;
const DISTRIBUTED_REFRESH_WAIT_TIMEOUT_MS = 1_500;
const DISTRIBUTED_REFRESH_WAIT_INTERVAL_MS = 80;

export type DistributedRefreshLockAcquireResult =
    | {
          status: "acquired";
          release: () => Promise<void>;
      }
    | {
          status: "busy";
      }
    | {
          status: "unavailable";
      };

function normalizeRefreshToken(refreshToken: string): string {
    return String(refreshToken || "").trim();
}

function hashRefreshToken(refreshToken: string): string {
    return createHash("sha256").update(refreshToken).digest("hex");
}

function buildResultKey(refreshToken: string): string {
    return prefixRedisKey(
        `${DISTRIBUTED_REFRESH_KEY_PREFIX}:result:${hashRefreshToken(refreshToken)}`,
    );
}

function buildLockKey(refreshToken: string): string {
    return prefixRedisKey(
        `${DISTRIBUTED_REFRESH_KEY_PREFIX}:lock:${hashRefreshToken(refreshToken)}`,
    );
}

function toStoredTokensJson(tokens: DirectusAuthTokens): string {
    const normalized: {
        accessToken: string;
        refreshToken: string;
        expiresMs?: number;
    } = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
    };

    if (
        typeof tokens.expiresMs === "number" &&
        Number.isFinite(tokens.expiresMs)
    ) {
        normalized.expiresMs = tokens.expiresMs;
    }

    return JSON.stringify(normalized);
}

function parseStoredTokens(raw: string): DirectusAuthTokens | null {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") {
            return null;
        }

        const candidate = parsed as {
            accessToken?: unknown;
            refreshToken?: unknown;
            expiresMs?: unknown;
        };

        if (
            typeof candidate.accessToken !== "string" ||
            !candidate.accessToken.trim() ||
            typeof candidate.refreshToken !== "string" ||
            !candidate.refreshToken.trim()
        ) {
            return null;
        }

        const expiresMs =
            typeof candidate.expiresMs === "number" &&
            Number.isFinite(candidate.expiresMs)
                ? candidate.expiresMs
                : undefined;

        return {
            accessToken: candidate.accessToken,
            refreshToken: candidate.refreshToken,
            expiresMs,
        };
    } catch {
        return null;
    }
}

function waitFor(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function getDistributedRefreshResult(
    refreshToken: string,
): Promise<DirectusAuthTokens | null> {
    const normalizedRefreshToken = normalizeRefreshToken(refreshToken);
    if (!normalizedRefreshToken) {
        return null;
    }

    const redis = getUpstashRedisClient({
        automaticDeserialization: false,
    });
    if (!redis) {
        return null;
    }
    const key = buildResultKey(normalizedRefreshToken);

    try {
        const raw = await redis.get<string>(key);
        if (typeof raw !== "string" || !raw) {
            return null;
        }
        return parseStoredTokens(raw);
    } catch {
        return null;
    }
}

export async function cacheDistributedRefreshResult(params: {
    sourceRefreshToken: string;
    tokens: DirectusAuthTokens;
}): Promise<void> {
    const sourceRefreshToken = normalizeRefreshToken(params.sourceRefreshToken);
    const newRefreshToken = normalizeRefreshToken(params.tokens.refreshToken);
    if (!sourceRefreshToken || !newRefreshToken) {
        return;
    }

    const redis = getUpstashRedisClient({
        automaticDeserialization: false,
    });
    if (!redis) {
        return;
    }

    const payload = toStoredTokensJson(params.tokens);
    const sourceKey = buildResultKey(sourceRefreshToken);
    const nextKey = buildResultKey(newRefreshToken);

    try {
        await redis.set(sourceKey, payload, {
            ex: DISTRIBUTED_REFRESH_RESULT_TTL_SECONDS,
        });
        if (nextKey !== sourceKey) {
            await redis.set(nextKey, payload, {
                ex: DISTRIBUTED_REFRESH_RESULT_TTL_SECONDS,
            });
        }
    } catch {
        // Redis 不可用时静默降级到单实例内存锁
    }
}

export async function tryAcquireDistributedRefreshLock(
    refreshToken: string,
): Promise<DistributedRefreshLockAcquireResult> {
    const normalizedRefreshToken = normalizeRefreshToken(refreshToken);
    if (!normalizedRefreshToken) {
        return { status: "unavailable" };
    }

    const redis = getUpstashRedisClient({
        automaticDeserialization: false,
    });
    if (!redis) {
        return { status: "unavailable" };
    }

    const key = buildLockKey(normalizedRefreshToken);
    const owner = randomUUID();

    try {
        const lockResult = await redis.set(key, owner, {
            ex: DISTRIBUTED_REFRESH_LOCK_TTL_SECONDS,
            nx: true,
        });

        if (lockResult !== "OK") {
            return { status: "busy" };
        }

        let released = false;
        return {
            status: "acquired",
            release: async () => {
                if (released) {
                    return;
                }
                released = true;
                try {
                    const currentOwner = await redis.get<string>(key);
                    if (currentOwner !== owner) {
                        return;
                    }
                    await redis.del(key);
                } catch {
                    // 锁释放失败依赖 TTL 自动回收
                }
            },
        };
    } catch {
        return { status: "unavailable" };
    }
}

export async function waitDistributedRefreshResult(
    refreshToken: string,
    options?: {
        timeoutMs?: number;
        pollIntervalMs?: number;
    },
): Promise<DirectusAuthTokens | null> {
    const timeoutMs = Math.max(
        0,
        Math.floor(options?.timeoutMs ?? DISTRIBUTED_REFRESH_WAIT_TIMEOUT_MS),
    );
    const pollIntervalMs = Math.max(
        20,
        Math.floor(
            options?.pollIntervalMs ?? DISTRIBUTED_REFRESH_WAIT_INTERVAL_MS,
        ),
    );

    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
        const cached = await getDistributedRefreshResult(refreshToken);
        if (cached) {
            return cached;
        }

        if (Date.now() >= deadline) {
            break;
        }

        await waitFor(pollIntervalMs);
    }

    return null;
}
