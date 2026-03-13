import { describe, it, expect } from "vitest";

import { isWriteMethod, parseSegments } from "@/server/api/v1/shared/routing";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function makeContext(segments?: string): any {
        return { params: { segments } };
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
