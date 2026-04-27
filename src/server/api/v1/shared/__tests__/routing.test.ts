import type { APIContext } from "astro";
import { describe, it, expect } from "vitest";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";
import {
    assertSameOrigin,
    isWriteMethod,
    parseSegments,
} from "@/server/api/v1/shared/routing";

describe("isWriteMethod", () => {
    it("POST → true", () => {
        expect(isWriteMethod("POST")).toBe(true);
    });
    it("PATCH → true", () => {
        expect(isWriteMethod("PATCH")).toBe(true);
    });
    it("DELETE → true", () => {
        expect(isWriteMethod("DELETE")).toBe(true);
    });
    it("GET → false", () => {
        expect(isWriteMethod("GET")).toBe(false);
    });
    it("PUT → true", () => {
        expect(isWriteMethod("PUT")).toBe(true);
    });
});

describe("parseSegments", () => {
    function makeContext(segments?: string): APIContext {
        return {
            params: { segments },
        } as unknown as APIContext;
    }

    it("undefined → []", () => {
        expect(parseSegments(makeContext(undefined))).toEqual([]);
    });
    it("空字符串 → []", () => {
        expect(parseSegments(makeContext(""))).toEqual([]);
    });
    it("单段", () => {
        expect(parseSegments(makeContext("articles"))).toEqual(["articles"]);
    });
    it("多段", () => {
        expect(parseSegments(makeContext("me/articles/123"))).toEqual([
            "me",
            "articles",
            "123",
        ]);
    });
    it("尾斜杠", () => {
        expect(parseSegments(makeContext("a/b/"))).toEqual(["a", "b"]);
    });
});

describe("assertSameOrigin", () => {
    it("接受与内部请求 origin 一致的来源", () => {
        const context = createMockAPIContext({
            method: "POST",
            url: "http://web:4321/api/v1/me/articles",
            headers: { origin: "http://web:4321" },
        });

        expect(assertSameOrigin(context as unknown as APIContext)).toBeNull();
    });

    it("接受反向代理透传的外部来源", () => {
        const context = createMockAPIContext({
            method: "POST",
            url: "http://web:4321/api/v1/me/articles",
            headers: {
                origin: "https://localhost",
                "x-forwarded-host": "localhost",
                "x-forwarded-proto": "https",
            },
        });

        expect(assertSameOrigin(context as unknown as APIContext)).toBeNull();
    });

    it("接受反向代理保留的 Host 头作为外部来源回退", () => {
        const context = createMockAPIContext({
            method: "POST",
            url: "http://web:4321/api/v1/me/articles",
            headers: {
                origin: "https://www.ciallichannel.com",
                host: "www.ciallichannel.com",
                "x-forwarded-proto": "https",
            },
        });

        expect(assertSameOrigin(context as unknown as APIContext)).toBeNull();
    });

    it("接受标准 Forwarded 头透传的外部来源", () => {
        const context = createMockAPIContext({
            method: "POST",
            url: "http://web:4321/api/v1/me/articles",
            headers: {
                origin: "https://demo.ciallichannel.com",
                forwarded:
                    'for=203.0.113.10;proto=https;host="demo.ciallichannel.com"',
            },
        });

        expect(assertSameOrigin(context as unknown as APIContext)).toBeNull();
    });

    it("拒绝未知来源", async () => {
        const context = createMockAPIContext({
            method: "POST",
            url: "http://web:4321/api/v1/me/articles",
            headers: {
                origin: "https://evil.example",
                "x-forwarded-host": "localhost",
                "x-forwarded-proto": "https",
            },
        });

        const response = assertSameOrigin(context as unknown as APIContext);
        expect(response?.status).toBe(403);
        await expect(response?.text()).resolves.toContain("非法来源请求");
    });

    it("缺少 Origin 头时拒绝请求", async () => {
        const context = createMockAPIContext({
            method: "POST",
            url: "http://web:4321/api/v1/me/articles",
            headers: { origin: "" },
        });

        const response = assertSameOrigin(context as unknown as APIContext);
        expect(response?.status).toBe(403);
        await expect(response?.text()).resolves.toContain("缺少 Origin 头");
    });
});
