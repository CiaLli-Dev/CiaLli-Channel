import { describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "@/server/request-context";

vi.mock("@directus/sdk", () => {
    const client = {
        with() {
            return client;
        },
        request: vi.fn().mockRejectedValue(new Error("sdk-called")),
    };

    return {
        aggregate: vi.fn(),
        createDirectus: vi.fn(() => client),
        createItem: vi.fn(),
        createUser: vi.fn(),
        customEndpoint: vi.fn(),
        deleteFile: vi.fn(),
        deleteItem: vi.fn(),
        readFile: vi.fn(),
        readItem: vi.fn(),
        readItems: vi.fn(() => ({ mocked: true })),
        readFiles: vi.fn(),
        readUser: vi.fn(),
        readUsers: vi.fn(),
        rest: vi.fn(() => ({})),
        staticToken: vi.fn(() => ({})),
        updateItem: vi.fn(),
        updateItems: vi.fn(),
        updateFile: vi.fn(),
        updateUser: vi.fn(),
        uploadFiles: vi.fn(),
        withToken: vi.fn((token: string, request: unknown) => ({
            token,
            request,
        })),
    };
});

describe("directus client scope guard", () => {
    it("缺少请求上下文和显式 scope 时直接报错", async () => {
        const { readMany } = await import("@/server/directus/client");
        await expect(readMany("app_articles")).rejects.toMatchObject({
            code: "INTERNAL_ERROR",
            message: expect.stringContaining("Directus 访问缺少 request scope"),
        });
    });

    it("请求上下文内未声明显式 scope 时同样报错", async () => {
        const { readMany } = await import("@/server/directus/client");
        await expect(
            runWithRequestContext(
                {
                    requestId: "req-service",
                    language: "zh_CN",
                },
                async () => await readMany("app_articles", { limit: 1 }),
            ),
        ).rejects.toMatchObject({
            code: "INTERNAL_ERROR",
            message: expect.stringContaining("Directus 访问缺少 request scope"),
        });
    });
});
