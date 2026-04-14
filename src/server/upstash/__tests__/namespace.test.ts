import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRedisNamespace = process.env.REDIS_NAMESPACE;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalVercelGitCommitRef = process.env.VERCEL_GIT_COMMIT_REF;
const originalNodeEnv = process.env.NODE_ENV;

function resetNamespaceEnv(): void {
    delete process.env.REDIS_NAMESPACE;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_GIT_COMMIT_REF;
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

    if (originalVercelEnv === undefined) {
        delete process.env.VERCEL_ENV;
    } else {
        process.env.VERCEL_ENV = originalVercelEnv;
    }

    if (originalVercelGitCommitRef === undefined) {
        delete process.env.VERCEL_GIT_COMMIT_REF;
    } else {
        process.env.VERCEL_GIT_COMMIT_REF = originalVercelGitCommitRef;
    }

    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }
});

describe("server/upstash/namespace", () => {
    it("优先使用显式 REDIS_NAMESPACE", async () => {
        process.env.REDIS_NAMESPACE = "Preview:Feature/About Page";
        process.env.VERCEL_ENV = "production";

        const { getRedisNamespace, prefixRedisKey } =
            await import("@/server/upstash/namespace");

        expect(getRedisNamespace()).toBe("preview:feature-about-page");
        expect(prefixRedisKey("cache:v1:article-list:__ver__")).toBe(
            "cialli:preview:feature-about-page:cache:v1:article-list:__ver__",
        );
    });

    it("预览环境按分支名推导 namespace", async () => {
        process.env.VERCEL_ENV = "preview";
        process.env.VERCEL_GIT_COMMIT_REF = "Feature/Improve-About_Page";

        const { getRedisNamespace } =
            await import("@/server/upstash/namespace");

        expect(getRedisNamespace()).toBe("preview:feature-improve-about_page");
    });

    it("本地测试环境回退到 dev:test", async () => {
        process.env.NODE_ENV = "test";

        const { getRedisNamespace } =
            await import("@/server/upstash/namespace");

        expect(getRedisNamespace()).toBe("dev:test");
    });

    it("生产环境缺失显式 namespace 时直接报错", async () => {
        process.env.NODE_ENV = "production";
        process.env.VERCEL_ENV = "production";

        const { getRedisNamespace, getRedisNamespaceOrThrow } =
            await import("@/server/upstash/namespace");

        expect(getRedisNamespace()).toBeNull();
        expect(() => getRedisNamespaceOrThrow()).toThrow(
            "生产环境已启用 Upstash Redis，但 REDIS_NAMESPACE 未配置；请为当前环境设置独立的 Redis 命名空间",
        );
    });
});
