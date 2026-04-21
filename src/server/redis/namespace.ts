import { internal } from "@/server/api/errors";

type RedisNamespaceSource = "explicit" | "derived" | "missing";

export type RedisNamespaceResolution = {
    namespace: string | null;
    source: RedisNamespaceSource;
};

const REDIS_KEY_ROOT = "cialli";
const MAX_NAMESPACE_PART_LENGTH = 48;

let cachedResolution: RedisNamespaceResolution | undefined;

function readEnvValue(name: "REDIS_NAMESPACE" | "NODE_ENV"): string {
    return String(process.env[name] || import.meta.env[name] || "").trim();
}

function collapseRepeatedDashes(value: string): string {
    return value.replace(/-+/g, "-");
}

function sanitizeNamespacePart(value: string): string {
    const normalized = collapseRepeatedDashes(
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-"),
    ).replace(/^[-_]+|[-_]+$/g, "");

    if (!normalized) {
        return "";
    }

    return normalized.slice(0, MAX_NAMESPACE_PART_LENGTH);
}

function sanitizeExplicitNamespace(value: string): string {
    const parts = value
        .split(":")
        .map((entry) => sanitizeNamespacePart(entry))
        .filter(Boolean);

    return parts.join(":");
}

function resolveDerivedNamespace(): string | null {
    const nodeEnv = readEnvValue("NODE_ENV").toLowerCase();
    if (nodeEnv === "production") {
        return null;
    }
    if (nodeEnv === "test") {
        return "dev:test";
    }
    return "dev:local";
}

export function getRedisNamespaceResolution(): RedisNamespaceResolution {
    if (cachedResolution) {
        return cachedResolution;
    }

    const explicitNamespace = sanitizeExplicitNamespace(
        readEnvValue("REDIS_NAMESPACE"),
    );
    if (explicitNamespace) {
        cachedResolution = {
            namespace: explicitNamespace,
            source: "explicit",
        };
        return cachedResolution;
    }

    const derivedNamespace = resolveDerivedNamespace();
    cachedResolution = {
        namespace: derivedNamespace,
        source: derivedNamespace ? "derived" : "missing",
    };
    return cachedResolution;
}

export function getRedisNamespace(): string | null {
    return getRedisNamespaceResolution().namespace;
}

export function getRedisNamespaceOrThrow(): string {
    const resolution = getRedisNamespaceResolution();
    if (resolution.namespace) {
        return resolution.namespace;
    }

    throw internal(
        "生产环境已启用 Redis，但 REDIS_NAMESPACE 未配置；请为当前环境设置独立的 Redis 命名空间",
    );
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
