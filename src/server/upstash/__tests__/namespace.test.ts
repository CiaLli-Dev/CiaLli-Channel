import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

function resetNamespaceEnv(): void {
    delete process.env.NODE_ENV;
}

beforeEach(() => {
    vi.resetModules();
    resetNamespaceEnv();
});

afterEach(() => {
    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }
});

describe("server/redis/namespace", () => {
    it("测试环境回退到 dev:test", async () => {
        process.env.NODE_ENV = "test";

        const { getRedisNamespace, prefixRedisKey } =
            await import("@/server/redis/namespace");

        expect(getRedisNamespace()).toBe("dev:test");
        expect(prefixRedisKey("cache:v1:article-list:__ver__")).toBe(
            "cialli:dev:test:cache:v1:article-list:__ver__",
        );
    });

    it("本地开发环境回退到 dev:local", async () => {
        process.env.NODE_ENV = "development";

        const { getRedisNamespace } = await import("@/server/redis/namespace");

        expect(getRedisNamespace()).toBe("dev:local");
    });

    it("生产环境固定使用 prod namespace", async () => {
        process.env.NODE_ENV = "production";

        const { getRedisNamespace, getRedisNamespaceOrThrow } =
            await import("@/server/redis/namespace");

        expect(getRedisNamespace()).toBe("prod");
        expect(getRedisNamespaceOrThrow()).toBe("prod");
    });
});
