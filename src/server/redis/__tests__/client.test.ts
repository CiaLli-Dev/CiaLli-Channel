import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RedisCreateClientConfig = {
    url?: string;
};

const redisCreateClientMock = vi.fn();
const redisConnectMock = vi.fn();
const redisOnMock = vi.fn();
const redisSendCommandMock = vi.fn();

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
            sendCommand: redisSendCommandMock,
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
    redisSendCommandMock.mockReset();
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
        expect(redisCreateClientMock).not.toHaveBeenCalled();
    });

    it("按单例缓存 Redis 客户端包装器", async () => {
        process.env.REDIS_URL = "redis://redis.test:6379/0";

        const { getRedisClient } = await import("@/server/redis/client");

        const client = getRedisClient();
        const sameClient = getRedisClient();

        expect(client).toBe(sameClient);
        await client?.get("cache-key");
        expect(redisCreateClientMock).toHaveBeenCalledTimes(1);
        expect(redisCreateClientMock.mock.calls[0]?.[0]).toMatchObject({
            url: "redis://redis.test:6379/0",
        });
        expect(redisConnectMock).toHaveBeenCalledTimes(1);
        expect(redisOnMock).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("固定窗口自增通过 Lua 脚本原子设置 TTL", async () => {
        process.env.REDIS_URL = "redis://redis.test:6379/0";
        redisSendCommandMock.mockResolvedValue([1, 300]);

        const { getRedisClient } = await import("@/server/redis/client");

        const client = getRedisClient();
        const result = await client?.incrementFixedWindow(
            "rate-limit-key",
            300,
        );

        expect(result).toEqual({ current: 1, ttlSeconds: 300 });
        expect(redisSendCommandMock).toHaveBeenCalledWith([
            "EVAL",
            expect.stringContaining('redis.call("INCR", KEYS[1])'),
            "1",
            "rate-limit-key",
            "300",
        ]);
    });

    it("只在值匹配时删除锁", async () => {
        process.env.REDIS_URL = "redis://redis.test:6379/0";
        redisSendCommandMock.mockResolvedValue(1);

        const { getRedisClient } = await import("@/server/redis/client");

        const client = getRedisClient();
        const deleted = await client?.delIfValue("lock-key", "owner-1");

        expect(deleted).toBe(true);
        expect(redisSendCommandMock).toHaveBeenCalledWith([
            "EVAL",
            expect.stringContaining('redis.call("GET", KEYS[1])'),
            "1",
            "lock-key",
            "owner-1",
        ]);
    });
});
