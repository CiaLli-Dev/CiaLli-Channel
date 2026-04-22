import { internal } from "@/server/api/errors";

type RedisNamespaceSource = "fixed";

export type RedisNamespaceResolution = {
    namespace: string;
    source: RedisNamespaceSource;
};

const REDIS_KEY_ROOT = "cialli";

let cachedResolution: RedisNamespaceResolution | undefined;

function readEnvValue(name: "NODE_ENV"): string {
    return String(process.env[name] || import.meta.env[name] || "").trim();
}

function resolveDerivedNamespace(): string {
    const nodeEnv = readEnvValue("NODE_ENV").toLowerCase();
    if (nodeEnv === "test") {
        return "dev:test";
    }
    if (nodeEnv === "production") {
        return "prod";
    }
    return "dev:local";
}

export function getRedisNamespaceResolution(): RedisNamespaceResolution {
    if (cachedResolution) {
        return cachedResolution;
    }

    cachedResolution = {
        namespace: resolveDerivedNamespace(),
        source: "fixed",
    };
    return cachedResolution;
}

export function getRedisNamespace(): string {
    return getRedisNamespaceResolution().namespace;
}

export function getRedisNamespaceOrThrow(): string {
    return getRedisNamespaceResolution().namespace;
}

export function prefixRedisKey(rawKey: string): string {
    const normalizedRawKey = String(rawKey || "")
        .trim()
        .replace(/^:+/, "");
    if (!normalizedRawKey) {
        throw internal("Redis 键不能为空");
    }

    return `${REDIS_KEY_ROOT}:${getRedisNamespaceOrThrow()}:${normalizedRawKey}`;
}
