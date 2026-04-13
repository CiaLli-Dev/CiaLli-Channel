import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limitMock = vi.fn();
const ratelimitConstructorMock = vi.fn();
const slidingWindowMock = vi.fn((limit: number, window: string) => ({
    limit,
    window,
}));

const getUpstashRedisClientMock = vi.fn();
const getUpstashRedisConfigMock = vi.fn();

class MockRatelimit {
    static slidingWindow = slidingWindowMock;

    readonly limit = limitMock;

    constructor(config: unknown) {
        ratelimitConstructorMock(config);
    }
}

vi.mock("@upstash/ratelimit", () => ({
    Ratelimit: MockRatelimit,
}));

vi.mock("@/server/upstash/redis", () => ({
    getUpstashRedisClient: getUpstashRedisClientMock,
    getUpstashRedisConfig: getUpstashRedisConfigMock,
}));

const originalNodeEnv = process.env.NODE_ENV;
const originalRedisNamespace = process.env.REDIS_NAMESPACE;

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    limitMock.mockReset();
    ratelimitConstructorMock.mockReset();
    slidingWindowMock.mockClear();
    getUpstashRedisClientMock.mockReset();
    getUpstashRedisConfigMock.mockReset();
    process.env.NODE_ENV = "development";
    process.env.REDIS_NAMESPACE = "test-rate-limit";
});

describe("security/rate-limit", () => {
    it("开发环境缺失 Upstash 配置时回退到内存限流", async () => {
        getUpstashRedisConfigMock.mockReturnValue(null);

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        const first = await applyRateLimit(" 127.0.0.1 ", "auth");
        const second = await applyRateLimit("127.0.0.1", "auth");

        expect(first).toMatchObject({ ok: true, remaining: 9 });
        expect(second).toMatchObject({ ok: true, remaining: 8 });
        expect(getUpstashRedisClientMock).not.toHaveBeenCalled();
        expect(ratelimitConstructorMock).not.toHaveBeenCalled();
    });

    it("生产环境缺失 Upstash 配置时抛出既有错误", async () => {
        process.env.NODE_ENV = "production";
        getUpstashRedisConfigMock.mockReturnValue(null);

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        await expect(applyRateLimit("127.0.0.1", "auth")).rejects.toMatchObject(
            {
                code: "INTERNAL_ERROR",
                status: 500,
                message: "Upstash 限流服务未配置",
            },
        );
    });

    it("存在 Upstash 配置时复用共享 Redis 客户端并缓存分类实例", async () => {
        const redis = { name: "shared-redis" };
        getUpstashRedisConfigMock.mockReturnValue({
            url: "https://redis.test",
            token: "redis-token",
        });
        getUpstashRedisClientMock.mockReturnValue(redis);
        limitMock.mockResolvedValue({
            success: true,
            remaining: 9,
            reset: 1_726_000_000_000,
        });

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        const first = await applyRateLimit("127.0.0.1", "auth");
        const second = await applyRateLimit("127.0.0.1", "auth");

        expect(first).toEqual({
            ok: true,
            remaining: 9,
            resetAt: 1_726_000_000_000,
        });
        expect(second).toEqual({
            ok: true,
            remaining: 9,
            resetAt: 1_726_000_000_000,
        });
        expect(getUpstashRedisClientMock).toHaveBeenCalledTimes(1);
        expect(ratelimitConstructorMock).toHaveBeenCalledTimes(1);
        expect(slidingWindowMock).toHaveBeenCalledWith(10, "300 s");
        expect(ratelimitConstructorMock.mock.calls[0]?.[0]).toMatchObject({
            redis,
            analytics: false,
            prefix: "cialli:test-rate-limit:rl:auth",
        });
        expect(limitMock).toHaveBeenCalledTimes(2);
    });
});

afterEach(() => {
    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalRedisNamespace === undefined) {
        delete process.env.REDIS_NAMESPACE;
    } else {
        process.env.REDIS_NAMESPACE = originalRedisNamespace;
    }
});
