import { describe, it, expect } from "vitest";

import { json, ok, fail } from "@/server/api/response";

describe("json", () => {
    it("Content-Type 正确", () => {
        const res = json({ foo: "bar" });
        expect(res.headers.get("Content-Type")).toBe(
            "application/json; charset=utf-8",
        );
    });

    it("body 序列化正确", async () => {
        const data = { foo: 1, bar: "baz" };
        const res = json(data);
        const body = await res.json();
        expect(body).toEqual(data);
    });

    it("支持 ResponseInit headers", () => {
        const res = json({}, { headers: { "X-Custom": "test" } });
        expect(res.headers.get("X-Custom")).toBe("test");
    });
});

describe("ok", () => {
    it("返回 { ok: true, ...data }", async () => {
        const res = ok({ items: [1, 2] });
        const body = await res.json();
        expect(body).toEqual({ ok: true, items: [1, 2] });
    });

    it("空 data 不崩溃", async () => {
        const res = ok(null);
        const body = await res.json();
        expect(body.ok).toBe(true);
    });
});

describe("fail", () => {
    it("默认 status=400 + UNKNOWN_ERROR", async () => {
        const res = fail("出错了");
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toEqual({
            ok: false,
            error: { code: "UNKNOWN_ERROR", message: "出错了" },
        });
    });

    it("自定义 status 和 code", async () => {
        const res = fail("禁止", 403, "FORBIDDEN");
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error.code).toBe("FORBIDDEN");
    });
});
