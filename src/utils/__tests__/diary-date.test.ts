import { describe, expect, it } from "vitest";

import { resolveDiaryDisplayDateSource } from "@/utils/diary-date";

describe("resolveDiaryDisplayDateSource", () => {
    it("首页 Feed 传入覆写日期时优先使用覆写值", () => {
        const override = new Date("2026-03-27T12:00:00.000Z");

        expect(
            resolveDiaryDisplayDateSource(override, "2026-03-20T12:00:00.000Z"),
        ).toBe(override);
    });

    it("普通页面未传覆写日期时回退到创建时间", () => {
        expect(
            resolveDiaryDisplayDateSource(null, "2026-03-20T12:00:00.000Z"),
        ).toBe("2026-03-20T12:00:00.000Z");
    });
});
