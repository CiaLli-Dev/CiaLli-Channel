import { createClient } from "redis";

export type AppRedisConfig = {
    url: string;
};

export type AppRedisClientOptions = {
    /**
     * 保留旧调用点的兼容参数。
     * node-redis 默认返回字符串，不再区分 raw/default 两类客户端。
     */
    automaticDeserialization?: boolean;
};

export type AppRedisSetOptions = {
    ex?: number;
    nx?: boolean;
};

export type AppRedisClient = {
    get: <T extends string = string>(key: string) => Promise<T | null>;
    set: (
        key: string,
        value: string,
        options?: AppRedisSetOptions,
    ) => Promise<string | null>;
    del: (key: string) => Promise<number>;
    incr: (key: string) => Promise<number>;
    expire: (key: string, seconds: number) => Promise<number>;
    ttl: (key: string) => Promise<number>;
};

type RedisConnection = ReturnType<typeof createClient>;

let cachedConfig: AppRedisConfig | null | undefined;
let clientSingleton: RedisConnection | null | undefined;
let clientConnectTask: Promise<RedisConnection> | null = null;

function getEnvValue(name: "REDIS_URL"): string {
    return String(process.env[name] || import.meta.env[name] || "").trim();
}

export function getRedisConfig(): AppRedisConfig | null {
    if (cachedConfig !== undefined) {
        return cachedConfig;
    }

    const url = getEnvValue("REDIS_URL");
    cachedConfig = url ? { url } : null;
    return cachedConfig;
}

function buildRedisClient(config: AppRedisConfig): RedisConnection {
    const client = createClient({
        url: config.url,
        socket: {
            reconnectStrategy(retries) {
                return Math.min(500 * 2 ** retries, 5_000);
            },
        },
    });

    client.on("error", (error: unknown) => {
        console.error("[redis/client] 连接异常：", error);
    });

    return client;
}

async function getConnectedRedisClient(): Promise<RedisConnection | null> {
    if (clientSingleton) {
        return clientSingleton;
    }

    const config = getRedisConfig();
    if (!config) {
        return null;
    }

    if (!clientConnectTask) {
        const client = buildRedisClient(config);
        clientConnectTask = client
            .connect()
            .then(() => {
                clientSingleton = client;
                return client;
            })
            .catch((error) => {
                clientConnectTask = null;
                clientSingleton = null;
                throw error;
            });
    }

    return await clientConnectTask;
}

function normalizeSetOptions(options?: AppRedisSetOptions): {
    expiration?: { type: "EX"; value: number };
    condition?: "NX";
} {
    const normalized: {
        expiration?: { type: "EX"; value: number };
        condition?: "NX";
    } = {};

    if (
        typeof options?.ex === "number" &&
        Number.isFinite(options.ex) &&
        options.ex > 0
    ) {
        normalized.expiration = {
            type: "EX",
            value: Math.floor(options.ex),
        };
    }
    if (options?.nx === true) {
        normalized.condition = "NX";
    }

    return normalized;
}

const wrappedClient: AppRedisClient = {
    async get<T extends string = string>(key: string): Promise<T | null> {
        const client = await getConnectedRedisClient();
        if (!client) {
            return null;
        }
        return (await client.get(key)) as T | null;
    },
    async set(
        key: string,
        value: string,
        options?: AppRedisSetOptions,
    ): Promise<string | null> {
        const client = await getConnectedRedisClient();
        if (!client) {
            return null;
        }
        return await client.set(key, value, normalizeSetOptions(options));
    },
    async del(key: string): Promise<number> {
        const client = await getConnectedRedisClient();
        if (!client) {
            return 0;
        }
        return await client.del(key);
    },
    async incr(key: string): Promise<number> {
        const client = await getConnectedRedisClient();
        if (!client) {
            return 0;
        }
        return await client.incr(key);
    },
    async expire(key: string, seconds: number): Promise<number> {
        const client = await getConnectedRedisClient();
        if (!client) {
            return 0;
        }
        return await client.expire(key, Math.max(1, Math.floor(seconds)));
    },
    async ttl(key: string): Promise<number> {
        const client = await getConnectedRedisClient();
        if (!client) {
            return -2;
        }
        return await client.ttl(key);
    },
};

export function getRedisClient(
    _options?: AppRedisClientOptions,
): AppRedisClient | null {
    if (!getRedisConfig()) {
        return null;
    }

    return wrappedClient;
}
