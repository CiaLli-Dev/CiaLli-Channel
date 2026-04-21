import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRedisNamespace = process.env.REDIS_NAMESPACE;
const originalNodeEnv = process.env.NODE_ENV;

function resetNamespaceEnv(): void {
    delete process.env.REDIS_NAMESPACE;
    delete process.env.NODE_ENV;
}

beforeEach(() => {
    vi.resetModules();
    resetNamespaceEnv();
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
});

describe("server/redis/namespace", () => {
    it("优先使用显式 REDIS_NAMESPACE", async () => {
        process.env.REDIS_NAMESPACE = "Preview:Feature/About Page";

        const { getRedisNamespace, prefixRedisKey } =
            await import("@/server/redis/namespace");

        expect(getRedisNamespace()).toBe("preview:feature-about-page");
        expect(prefixRedisKey("cache:v1:article-list:__ver__")).toBe(
            "cialli:preview:feature-about-page:cache:v1:article-list:__ver__",
        );
    });

    it("测试环境回退到 dev:test", async () => {
        process.env.NODE_ENV = "test";

        const { getRedisNamespace } = await import("@/server/redis/namespace");

        expect(getRedisNamespace()).toBe("dev:test");
    });

    it("本地开发环境回退到 dev:local", async () => {
        process.env.NODE_ENV = "development";

        const { getRedisNamespace } = await import("@/server/redis/namespace");

        expect(getRedisNamespace()).toBe("dev:local");
    });

    it("生产环境缺失显式 namespace 时直接报错", async () => {
        process.env.NODE_ENV = "production";

        const { getRedisNamespace, getRedisNamespaceOrThrow } =
            await import("@/server/redis/namespace");

        expect(getRedisNamespace()).toBeNull();
        expect(() => getRedisNamespaceOrThrow()).toThrow(
            "生产环境已启用 Redis，但 REDIS_NAMESPACE 未配置；请为当前环境设置独立的 Redis 命名空间",
        );
    });
});
