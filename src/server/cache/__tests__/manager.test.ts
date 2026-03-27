import { beforeEach, describe, expect, it, vi } from "vitest";

type MockRedisClient = {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
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
        incr: vi.fn(),
    };
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getUpstashRedisClientMock.mockReset();
});

describe("cache/manager", () => {
    it("L2 命中后会回填 L1，后续读取不再访问 Redis", async () => {
        const redis = createRedisClientMock();
        redis.get
            .mockResolvedValueOnce("0")
            .mockResolvedValueOnce(JSON.stringify({ title: "hello" }));
        getUpstashRedisClientMock.mockReturnValue(redis);

        const { cacheManager } = await import("@/server/cache/manager");

        const first = await cacheManager.get<{ title: string }>(
            "article-list",
            "article-1",
        );
        const second = await cacheManager.get<{ title: string }>(
            "article-list",
            "article-1",
        );

        expect(first).toEqual({ title: "hello" });
        expect(second).toEqual({ title: "hello" });
        expect(redis.get).toHaveBeenCalledTimes(2);
        expect(redis.get.mock.calls[0]?.[0]).toBe("v1:article-list:__ver__");
        expect(redis.get.mock.calls[1]?.[0]).toBe(
            "v1:article-list:v0:article-1",
        );
        expect(getUpstashRedisClientMock).toHaveBeenCalledWith({
            automaticDeserialization: false,
        });
    });

    it("版本读取失败时仍按 v0 写入，并保留原有 TTL 秒数", async () => {
        const redis = createRedisClientMock();
        redis.get.mockRejectedValue(new Error("redis unavailable"));
        redis.set.mockResolvedValue("OK");
        getUpstashRedisClientMock.mockReturnValue(redis);

        const { cacheManager } = await import("@/server/cache/manager");

        await cacheManager.set("article-list", "list-key", {
            items: [1, 2, 3],
        });

        expect(redis.set).toHaveBeenCalledWith(
            "v1:article-list:v0:list-key",
            JSON.stringify({ items: [1, 2, 3] }),
            { ex: 120 },
        );
    });

    it("整域失效时只递增当前 home-feed 域版本号", async () => {
        const redis = createRedisClientMock();
        redis.incr.mockResolvedValue(1);
        getUpstashRedisClientMock.mockReturnValue(redis);

        const { cacheManager } = await import("@/server/cache/manager");

        await cacheManager.invalidateByDomain("home-feed");

        expect(redis.incr.mock.calls.map(([key]) => key)).toEqual([
            "v1:home-feed:__ver__",
        ]);
    });

    it("版本递增失败时仍使用默认 v1 继续写入", async () => {
        const redis = createRedisClientMock();
        redis.incr.mockRejectedValue(new Error("incr failed"));
        redis.set.mockResolvedValue("OK");
        getUpstashRedisClientMock.mockReturnValue(redis);

        const { cacheManager } = await import("@/server/cache/manager");

        await cacheManager.invalidateByDomain("article-list");
        await cacheManager.set("article-list", "list-key", { ok: true });

        expect(redis.set).toHaveBeenCalledWith(
            "v1:article-list:v1:list-key",
            JSON.stringify({ ok: true }),
            { ex: 120 },
        );
    });
});
