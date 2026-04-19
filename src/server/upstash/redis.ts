import { Redis } from "@upstash/redis";
import { readRuntimeEnv } from "@/server/env/runtime";

export type UpstashRedisConfig = {
    url: string;
    token: string;
};

export type UpstashRedisClientOptions = {
    automaticDeserialization?: boolean;
};

type UpstashRedisClientMode = "default" | "raw";

let cachedConfig: UpstashRedisConfig | null | undefined;

// 同一个进程内维护两类 Redis 单例：
// - default: 保持 SDK 默认反序列化行为，供 rate-limit 使用
// - raw: 禁用自动反序列化，供缓存层按字符串读写 JSON
const clientCache: Record<UpstashRedisClientMode, Redis | null | undefined> = {
    default: undefined,
    raw: undefined,
};

function getEnvValue(name: "KV_REST_API_URL" | "KV_REST_API_TOKEN"): string {
    return readRuntimeEnv(name);
}

function resolveClientMode(
    options?: UpstashRedisClientOptions,
): UpstashRedisClientMode {
    return options?.automaticDeserialization === false ? "raw" : "default";
}

export function getUpstashRedisConfig(): UpstashRedisConfig | null {
    if (cachedConfig !== undefined) {
        return cachedConfig;
    }

    const url = getEnvValue("KV_REST_API_URL");
    const token = getEnvValue("KV_REST_API_TOKEN");
    cachedConfig = url && token ? { url, token } : null;
    return cachedConfig;
}

export function getUpstashRedisClient(
    options?: UpstashRedisClientOptions,
): Redis | null {
    const mode = resolveClientMode(options);
    const cachedClient = clientCache[mode];
    if (cachedClient !== undefined) {
        return cachedClient;
    }

    const config = getUpstashRedisConfig();
    if (!config) {
        clientCache[mode] = null;
        return null;
    }

    clientCache[mode] =
        mode === "raw"
            ? new Redis({
                  ...config,
                  automaticDeserialization: false,
              })
            : new Redis(config);

    return clientCache[mode];
}
