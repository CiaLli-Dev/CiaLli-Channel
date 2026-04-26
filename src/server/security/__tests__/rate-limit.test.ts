import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRedisClientMock = vi.fn();
const getRedisConfigMock = vi.fn();

vi.mock("@/server/redis/client", () => ({
    getRedisClient: getRedisClientMock,
    getRedisConfig: getRedisConfigMock,
}));

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getRedisClientMock.mockReset();
    getRedisConfigMock.mockReset();
    process.env.NODE_ENV = "development";
});

describe("security/rate-limit", () => {
    it("开发环境缺失 Redis 配置时回退到内存限流", async () => {
        getRedisConfigMock.mockReturnValue(null);

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        const first = await applyRateLimit(" 127.0.0.1 ", "auth");
        const second = await applyRateLimit("127.0.0.1", "auth");

        expect(first).toMatchObject({ ok: true, remaining: 9 });
        expect(second).toMatchObject({ ok: true, remaining: 8 });
        expect(getRedisClientMock).not.toHaveBeenCalled();
    });

    it("生产环境缺失 Redis 配置时抛出既有错误", async () => {
        process.env.NODE_ENV = "production";
        getRedisConfigMock.mockReturnValue(null);

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        await expect(applyRateLimit("127.0.0.1", "auth")).rejects.toMatchObject(
            {
                code: "INTERNAL_ERROR",
                status: 500,
                message: "Redis 限流服务未配置",
            },
        );
    });

    it("存在 Redis 配置时使用带命名空间的固定窗口键", async () => {
        const redis = {
            incrementFixedWindow: vi.fn().mockResolvedValue({
                current: 1,
                ttlSeconds: 300,
            }),
        };
        getRedisConfigMock.mockReturnValue({
            url: "redis://redis.test:6379/0",
        });
        getRedisClientMock.mockReturnValue(redis);

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        const first = await applyRateLimit("127.0.0.1", "auth");

        expect(first).toEqual({
            ok: true,
            remaining: 9,
            resetAt: expect.any(Number),
        });
        expect(redis.incrementFixedWindow).toHaveBeenCalledWith(
            "cialli:dev:local:rl:auth:ip:127.0.0.1",
            300,
        );
    });

    it("超过阈值时返回 ok=false 且不出现负数剩余额度", async () => {
        const redis = {
            incrementFixedWindow: vi.fn().mockResolvedValue({
                current: 12,
                ttlSeconds: 120,
            }),
        };
        getRedisConfigMock.mockReturnValue({
            url: "redis://redis.test:6379/0",
        });
        getRedisClientMock.mockReturnValue(redis);

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        await expect(applyRateLimit("127.0.0.1", "auth")).resolves.toEqual({
            ok: false,
            remaining: 0,
            resetAt: expect.any(Number),
        });
        expect(redis.incrementFixedWindow).toHaveBeenCalledTimes(1);
    });

    it("registration-submit uses a short-window submission attempt bucket", async () => {
        const redis = {
            incrementFixedWindow: vi.fn().mockResolvedValue({
                current: 1,
                ttlSeconds: 60,
            }),
        };
        getRedisConfigMock.mockReturnValue({
            url: "redis://redis.test:6379/0",
        });
        getRedisClientMock.mockReturnValue(redis);

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        await expect(
            applyRateLimit("127.0.0.1", "registration-submit"),
        ).resolves.toEqual({
            ok: true,
            remaining: 19,
            resetAt: expect.any(Number),
        });
        expect(redis.incrementFixedWindow).toHaveBeenCalledWith(
            "cialli:dev:local:rl:registration-submit:v2:ip:127.0.0.1",
            60,
        );
    });

    it("registration-avatar uses the hourly avatar replace bucket", async () => {
        const redis = {
            incrementFixedWindow: vi.fn().mockResolvedValue({
                current: 1,
                ttlSeconds: 3600,
            }),
        };
        getRedisConfigMock.mockReturnValue({
            url: "redis://redis.test:6379/0",
        });
        getRedisClientMock.mockReturnValue(redis);

        const { applyRateLimit } = await import("@/server/security/rate-limit");

        await expect(
            applyRateLimit("127.0.0.1", "registration-avatar"),
        ).resolves.toEqual({
            ok: true,
            remaining: 9,
            resetAt: expect.any(Number),
        });
        expect(redis.incrementFixedWindow).toHaveBeenCalledWith(
            "cialli:dev:local:rl:registration-avatar:ip:127.0.0.1",
            3600,
        );
    });
});

afterEach(() => {
    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }
});
