import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RedisCreateClientConfig = {
    url?: string;
};

const redisCreateClientMock = vi.fn();
const redisConnectMock = vi.fn();
const redisOnMock = vi.fn();

vi.mock("redis", () => ({
    createClient: (config: RedisCreateClientConfig) => {
        redisCreateClientMock(config);
        return {
            connect: redisConnectMock.mockResolvedValue(undefined),
            on: redisOnMock,
            get: vi.fn(),
            set: vi.fn(),
            del: vi.fn(),
            incr: vi.fn(),
            expire: vi.fn(),
            ttl: vi.fn(),
        };
    },
}));

const originalUrl = process.env.REDIS_URL;

function resetRedisEnv(): void {
    delete process.env.REDIS_URL;
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    redisCreateClientMock.mockReset();
    redisConnectMock.mockReset();
    redisOnMock.mockReset();
    resetRedisEnv();
});

afterEach(() => {
    if (originalUrl === undefined) {
        delete process.env.REDIS_URL;
    } else {
        process.env.REDIS_URL = originalUrl;
    }
});

describe("server/redis/client", () => {
    it("缺失配置时返回 null 且不创建客户端", async () => {
        const { getRedisClient, getRedisConfig } =
            await import("@/server/redis/client");

        expect(getRedisConfig()).toBeNull();
        expect(getRedisClient()).toBeNull();
        expect(getRedisClient({ automaticDeserialization: false })).toBe(null);
        expect(redisCreateClientMock).not.toHaveBeenCalled();
    });

    it("按单例缓存 Redis 客户端包装器", async () => {
        process.env.REDIS_URL = "redis://redis.test:6379/0";

        const { getRedisClient } = await import("@/server/redis/client");

        const defaultClient = getRedisClient();
        const sameDefaultClient = getRedisClient();
        const rawClient = getRedisClient({
            automaticDeserialization: false,
        });
        const sameRawClient = getRedisClient({
            automaticDeserialization: false,
        });

        expect(defaultClient).toBe(sameDefaultClient);
        expect(rawClient).toBe(sameRawClient);
        expect(rawClient).toBe(defaultClient);
        await defaultClient?.get("cache-key");
        expect(redisCreateClientMock).toHaveBeenCalledTimes(1);
        expect(redisCreateClientMock.mock.calls[0]?.[0]).toMatchObject({
            url: "redis://redis.test:6379/0",
        });
        expect(redisConnectMock).toHaveBeenCalledTimes(1);
        expect(redisOnMock).toHaveBeenCalledWith("error", expect.any(Function));
    });
});
