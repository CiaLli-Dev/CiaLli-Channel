import { createClient } from "redis";

export type AppRedisConfig = {
    url: string;
};

export type AppRedisSetOptions = {
    ex?: number;
    nx?: boolean;
};

export type AppRedisFixedWindowResult = {
    current: number;
    ttlSeconds: number;
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
    incrementFixedWindow: (
        key: string,
        windowSeconds: number,
    ) => Promise<AppRedisFixedWindowResult>;
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

const FIXED_WINDOW_INCREMENT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
local ttl = redis.call("TTL", KEYS[1])

if current == 1 or ttl < 0 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end

return { current, ttl }
`;

function parseRedisInteger(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
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
    async incrementFixedWindow(
        key: string,
        windowSeconds: number,
    ): Promise<AppRedisFixedWindowResult> {
        const client = await getConnectedRedisClient();
        if (!client) {
            return { current: 0, ttlSeconds: -2 };
        }

        const normalizedWindowSeconds = Math.max(1, Math.floor(windowSeconds));
        const result = await client.sendCommand([
            "EVAL",
            FIXED_WINDOW_INCREMENT_SCRIPT,
            "1",
            key,
            String(normalizedWindowSeconds),
        ]);

        const [currentRaw, ttlRaw] = Array.isArray(result) ? result : [];
        const current = parseRedisInteger(currentRaw);
        const ttlSeconds = parseRedisInteger(ttlRaw);

        if (current === null || ttlSeconds === null) {
            return { current: 0, ttlSeconds: -2 };
        }

        return { current, ttlSeconds };
    },
};

export function getRedisClient(): AppRedisClient | null {
    if (!getRedisConfig()) {
        return null;
    }

    return wrappedClient;
}
