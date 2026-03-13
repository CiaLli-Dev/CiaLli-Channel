import { describe, it, expect, vi } from "vitest";

import { AppError } from "@/server/api/errors";

// mock logger 模块
vi.mock("@/server/api/logger", () => ({
    createRequestLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

import { withErrorHandler } from "@/server/middleware/error-handler";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockContext(): any {
    return {
        request: new Request("http://localhost:4321/api/v1/test"),
        url: new URL("http://localhost:4321/api/v1/test"),
        locals: { requestId: "test-id" },
    };
}

describe("withErrorHandler", () => {
    it("正常响应透传", async () => {
        const handler = vi.fn().mockResolvedValue(new Response("ok"));
        const wrapped = withErrorHandler(handler);
        const res = await wrapped(makeMockContext());
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toBe("ok");
    });

    it("AppError → 格式化为 fail 响应", async () => {
        const handler = vi
            .fn()
            .mockRejectedValue(new AppError("CUSTOM_ERROR", "自定义错误", 422));
        const wrapped = withErrorHandler(handler);
        const res = await wrapped(makeMockContext());
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body).toEqual({
            ok: false,
            error: { code: "CUSTOM_ERROR", message: "自定义错误" },
        });
    });

    it("未知异常 → 500 + INTERNAL_ERROR", async () => {
        const handler = vi.fn().mockRejectedValue(new Error("unexpected"));
        const wrapped = withErrorHandler(handler);
        const res = await wrapped(makeMockContext());
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body).toEqual({
            ok: false,
            error: { code: "INTERNAL_ERROR", message: "服务端错误" },
        });
    });

    it("DIRECTUS_* 错误响应脱敏", async () => {
        const handler = vi
            .fn()
            .mockRejectedValue(
                new AppError(
                    "DIRECTUS_ERROR",
                    "[directus/client] 读取集合 app_articles 列表失败 (400) codes=INVALID_QUERY",
                    400,
                ),
            );
        const wrapped = withErrorHandler(handler);
        const res = await wrapped(makeMockContext());
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toEqual({
            ok: false,
            error: {
                code: "DIRECTUS_ERROR",
                message: "请求参数无效",
            },
        });
    });
});
