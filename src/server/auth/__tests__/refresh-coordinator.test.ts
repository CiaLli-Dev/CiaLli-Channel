import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockRedisClient = {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
};

const getUpstashRedisClientMock = vi.fn();

vi.mock("@/server/upstash/redis", () => ({
    getUpstashRedisClient: getUpstashRedisClientMock,
}));

function createRedisClientMock(): MockRedisClient {
    return {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
    };
}

const originalRedisNamespace = process.env.REDIS_NAMESPACE;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getUpstashRedisClientMock.mockReset();
    process.env.REDIS_NAMESPACE = "test-refresh";
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL_ENV;
});

afterEach(() => {
    if (originalRedisNamespace === undefined) {
        delete process.env.REDIS_NAMESPACE;
    } else {
        process.env.REDIS_NAMESPACE = originalRedisNamespace;
    }

    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalVercelEnv === undefined) {
        delete process.env.VERCEL_ENV;
    } else {
        process.env.VERCEL_ENV = originalVercelEnv;
    }
});

describe("auth/refresh-coordinator", () => {
    it("读取分布式刷新结果时使用带 namespace 的 Redis 键", async () => {
        const redis = createRedisClientMock();
        redis.get.mockResolvedValue(
            JSON.stringify({
                accessToken: "access-token",
                refreshToken: "refresh-token",
                expiresMs: 12345,
            }),
        );
        getUpstashRedisClientMock.mockReturnValue(redis);

        const { getDistributedRefreshResult } =
            await import("@/server/auth/refresh-coordinator");

        const result = await getDistributedRefreshResult("refresh-token");

        expect(result).toEqual({
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresMs: 12345,
        });
        expect(redis.get).toHaveBeenCalledTimes(1);
        expect(redis.get.mock.calls[0]?.[0]).toMatch(
            /^cialli:test-refresh:auth:refresh:v1:result:/,
        );
    });

    it("生产环境缺失 REDIS_NAMESPACE 时直接抛错", async () => {
        const redis = createRedisClientMock();
        getUpstashRedisClientMock.mockReturnValue(redis);
        delete process.env.REDIS_NAMESPACE;
        process.env.NODE_ENV = "production";
        process.env.VERCEL_ENV = "production";

        const { getDistributedRefreshResult } =
            await import("@/server/auth/refresh-coordinator");

        await expect(
            getDistributedRefreshResult("refresh-token"),
        ).rejects.toThrow(
            "生产环境已启用 Upstash Redis，但 REDIS_NAMESPACE 未配置；请为当前环境设置独立的 Redis 命名空间",
        );
    });
});
