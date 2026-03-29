import { describe, expect, it } from "vitest";

import { calculateReadingProgressPercent } from "@/utils/reading-progress";

describe("calculateReadingProgressPercent", () => {
    it("正文起点之前返回 0%", () => {
        expect(
            calculateReadingProgressPercent({
                baselineY: 120,
                contentTop: 180,
                contentHeight: 600,
            }),
        ).toBe(0);
    });

    it("正文中段返回四舍五入后的百分比", () => {
        expect(
            calculateReadingProgressPercent({
                baselineY: 515,
                contentTop: 115,
                contentHeight: 800,
            }),
        ).toBe(50);
    });

    it("正文末尾及之后钳制到 100%", () => {
        expect(
            calculateReadingProgressPercent({
                baselineY: 980,
                contentTop: 120,
                contentHeight: 600,
            }),
        ).toBe(100);
    });

    it("正文高度异常时回退到 0%", () => {
        expect(
            calculateReadingProgressPercent({
                baselineY: 320,
                contentTop: 120,
                contentHeight: 0,
            }),
        ).toBe(0);
    });
});
