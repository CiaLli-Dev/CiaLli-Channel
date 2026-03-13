import { describe, it, expect } from "vitest";

import { weightedCharLength, charWeight } from "@/constants/text-limits";

describe("charWeight", () => {
    it("ASCII = 1", () => {
        expect(charWeight("a")).toBe(1);
        expect(charWeight("Z")).toBe(1);
        expect(charWeight("0")).toBe(1);
        expect(charWeight(" ")).toBe(1);
    });

    it("CJK = 2", () => {
        expect(charWeight("你")).toBe(2);
        expect(charWeight("好")).toBe(2);
        expect(charWeight("世")).toBe(2);
    });
});

describe("weightedCharLength", () => {
    it("纯 ASCII", () => {
        expect(weightedCharLength("hello")).toBe(5);
    });

    it("纯 CJK", () => {
        expect(weightedCharLength("你好")).toBe(4);
    });

    it("混合", () => {
        // "hi你好" = 2 + 2*2 = 6
        expect(weightedCharLength("hi你好")).toBe(6);
    });

    it("空字符串", () => {
        expect(weightedCharLength("")).toBe(0);
    });
});
