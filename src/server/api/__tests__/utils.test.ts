import { describe, it, expect } from "vitest";

import {
    parsePagination,
    parseJsonBody,
    toStringValue,
    toOptionalString,
    toBooleanValue,
    toNumberValue,
    toStringArray,
} from "@/server/api/utils";
import { AppError } from "@/server/api/errors";

// ── parsePagination ──

describe("parsePagination", () => {
    it("默认值 page=1 limit=20 offset=0", () => {
        const url = new URL("http://localhost/api");
        const result = parsePagination(url);
        expect(result).toEqual({ page: 1, limit: 20, offset: 0 });
    });

    it("page=0 → 1", () => {
        const url = new URL("http://localhost/api?page=0");
        expect(parsePagination(url).page).toBe(1);
    });

    it("limit=200 → 100（上限）", () => {
        const url = new URL("http://localhost/api?limit=200");
        expect(parsePagination(url).limit).toBe(100);
    });

    it("NaN → 默认值", () => {
        const url = new URL("http://localhost/api?page=abc&limit=xyz");
        const result = parsePagination(url);
        expect(result).toEqual({ page: 1, limit: 20, offset: 0 });
    });

    it("offset 计算正确", () => {
        const url = new URL("http://localhost/api?page=3&limit=10");
        expect(parsePagination(url).offset).toBe(20);
    });
});

// ── parseJsonBody ──

describe("parseJsonBody", () => {
    it("正常 JSON 对象", async () => {
        const req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ foo: "bar" }),
            headers: { "Content-Type": "application/json" },
        });
        const result = await parseJsonBody(req);
        expect(result).toEqual({ foo: "bar" });
    });

    it("非 JSON → 抛出 INVALID_JSON", async () => {
        const req = new Request("http://localhost", {
            method: "POST",
            body: "not json",
            headers: { "Content-Type": "text/plain" },
        });
        await expect(parseJsonBody(req)).rejects.toThrow(AppError);
        try {
            await parseJsonBody(
                new Request("http://localhost", {
                    method: "POST",
                    body: "bad",
                }),
            );
        } catch (error) {
            expect((error as AppError).code).toBe("INVALID_JSON");
        }
    });

    it("JSON 数组 → 抛出 INVALID_JSON_OBJECT", async () => {
        const req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify([1, 2]),
            headers: { "Content-Type": "application/json" },
        });
        await expect(parseJsonBody(req)).rejects.toThrow(AppError);
    });
});

// ── toStringValue ──

describe("toStringValue", () => {
    it("string 直接返回", () => {
        expect(toStringValue("hello")).toBe("hello");
    });
    it("number 转字符串", () => {
        expect(toStringValue(42)).toBe("42");
    });
    it("boolean 转字符串", () => {
        expect(toStringValue(true)).toBe("true");
    });
    it("null → 空字符串", () => {
        expect(toStringValue(null)).toBe("");
    });
    it("undefined → 空字符串", () => {
        expect(toStringValue(undefined)).toBe("");
    });
});

// ── toOptionalString ──

describe("toOptionalString", () => {
    it("空白 → null", () => {
        expect(toOptionalString("   ")).toBe(null);
    });
    it("非空 → trim", () => {
        expect(toOptionalString("  hello  ")).toBe("hello");
    });
    it("null → null", () => {
        expect(toOptionalString(null)).toBe(null);
    });
});

// ── toBooleanValue ──

describe("toBooleanValue", () => {
    it("boolean 直接返回", () => {
        expect(toBooleanValue(true)).toBe(true);
        expect(toBooleanValue(false)).toBe(false);
    });

    it("true 系列", () => {
        for (const v of ["1", "true", "yes", "on"]) {
            expect(toBooleanValue(v)).toBe(true);
        }
    });

    it("false 系列", () => {
        for (const v of ["0", "false", "no", "off"]) {
            expect(toBooleanValue(v)).toBe(false);
        }
    });

    it("fallback", () => {
        expect(toBooleanValue("unknown")).toBe(false);
        expect(toBooleanValue("unknown", true)).toBe(true);
    });
});

// ── toNumberValue ──

describe("toNumberValue", () => {
    it("number 直接返回", () => {
        expect(toNumberValue(42)).toBe(42);
    });
    it("string 能 parse", () => {
        expect(toNumberValue("3.14")).toBe(3.14);
    });
    it("NaN → fallback", () => {
        expect(toNumberValue("abc")).toBe(null);
        expect(toNumberValue("abc", 0)).toBe(0);
    });
    it("undefined → fallback", () => {
        expect(toNumberValue(undefined)).toBe(null);
    });
});

// ── toStringArray ──

describe("toStringArray", () => {
    it("数组过滤空字符串", () => {
        expect(toStringArray(["a", "", "b", " "])).toEqual(["a", "b"]);
    });
    it("逗号字符串", () => {
        expect(toStringArray("a, b, c")).toEqual(["a", "b", "c"]);
    });
    it("undefined → 空数组", () => {
        expect(toStringArray(undefined)).toEqual([]);
    });
    it("空字符串 → 空数组", () => {
        expect(toStringArray("")).toEqual([]);
    });
});
