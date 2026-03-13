import { describe, it, expect } from "vitest";

import {
    AppError,
    badRequest,
    unauthorized,
    forbidden,
    notFound,
    conflict,
    internal,
} from "@/server/api/errors";

describe("AppError", () => {
    it("构造属性正确", () => {
        const err = new AppError("TEST_CODE", "测试消息", 418);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("AppError");
        expect(err.code).toBe("TEST_CODE");
        expect(err.message).toBe("测试消息");
        expect(err.status).toBe(418);
        expect(err.details).toBeUndefined();
    });

    it("默认 status 为 400", () => {
        const err = new AppError("CODE", "msg");
        expect(err.status).toBe(400);
    });

    it("支持 details", () => {
        const err = new AppError("CODE", "msg", 400, { field: "value" });
        expect(err.details).toEqual({ field: "value" });
    });
});

describe("badRequest", () => {
    it("返回 400 + 自定义 code", () => {
        const err = badRequest("CUSTOM", "自定义消息");
        expect(err.status).toBe(400);
        expect(err.code).toBe("CUSTOM");
        expect(err.message).toBe("自定义消息");
    });
});

describe("unauthorized", () => {
    it("默认参数", () => {
        const err = unauthorized();
        expect(err.status).toBe(401);
        expect(err.code).toBe("UNAUTHORIZED");
        expect(err.message).toBe("未登录");
    });

    it("自定义消息", () => {
        const err = unauthorized("请先登录");
        expect(err.message).toBe("请先登录");
    });
});

describe("forbidden", () => {
    it("默认参数", () => {
        const err = forbidden();
        expect(err.status).toBe(403);
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toBe("权限不足");
    });

    it("自定义 code 和消息", () => {
        const err = forbidden("CUSTOM_FORBIDDEN", "自定义");
        expect(err.code).toBe("CUSTOM_FORBIDDEN");
        expect(err.message).toBe("自定义");
    });
});

describe("notFound", () => {
    it("默认参数", () => {
        const err = notFound();
        expect(err.status).toBe(404);
        expect(err.code).toBe("ITEM_NOT_FOUND");
        expect(err.message).toBe("资源不存在");
    });
});

describe("conflict", () => {
    it("返回 409", () => {
        const err = conflict("DUP", "重复");
        expect(err.status).toBe(409);
        expect(err.code).toBe("DUP");
    });
});

describe("internal", () => {
    it("默认参数", () => {
        const err = internal();
        expect(err.status).toBe(500);
        expect(err.code).toBe("INTERNAL_ERROR");
        expect(err.message).toBe("服务端错误");
    });

    it("带 details", () => {
        const err = internal("出错了", { stack: "..." });
        expect(err.details).toEqual({ stack: "..." });
    });
});
