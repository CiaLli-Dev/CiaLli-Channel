import { describe, it, expect } from "vitest";
import * as z from "zod";

import {
    AppStatusSchema,
    PaginationSchema,
    SocialLinksDefaultSchema,
    SocialLinksSchema,
    TagsDefaultSchema,
    TagsSchema,
} from "@/server/api/schemas/common";

describe("AppStatusSchema", () => {
    it("draft → 通过", () => {
        expect(AppStatusSchema.parse("draft")).toBe("draft");
    });
    it("published → 通过", () => {
        expect(AppStatusSchema.parse("published")).toBe("published");
    });
    it("archived → 通过", () => {
        expect(AppStatusSchema.parse("archived")).toBe("archived");
    });
    it("invalid → 失败", () => {
        expect(() => AppStatusSchema.parse("invalid")).toThrow(z.ZodError);
    });
});

describe("PaginationSchema", () => {
    it("默认值", () => {
        const result = PaginationSchema.parse({});
        expect(result).toEqual({ page: 1, limit: 20 });
    });

    it("coerce 字符串", () => {
        const result = PaginationSchema.parse({ page: "2", limit: "10" });
        expect(result).toEqual({ page: 2, limit: 10 });
    });

    it("limit 超 100 → 失败", () => {
        expect(() => PaginationSchema.parse({ page: 1, limit: 101 })).toThrow(
            z.ZodError,
        );
    });

    it("page 非正数 → 失败", () => {
        expect(() => PaginationSchema.parse({ page: 0 })).toThrow(z.ZodError);
    });
});

describe("TagsSchema", () => {
    it("正常数组", () => {
        expect(TagsSchema.parse(["a", "b"])).toEqual(["a", "b"]);
    });
    it("未提供 → 失败", () => {
        expect(() => TagsSchema.parse(undefined)).toThrow(z.ZodError);
    });
    it("超 20 个 → 失败", () => {
        const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
        expect(() => TagsSchema.parse(tags)).toThrow(z.ZodError);
    });
});

describe("TagsDefaultSchema", () => {
    it("未提供 → 默认 []", () => {
        expect(TagsDefaultSchema.parse(undefined)).toEqual([]);
    });
});

describe("SocialLinksSchema", () => {
    it("允许 null", () => {
        expect(SocialLinksSchema.parse(null)).toBeNull();
    });

    it("未提供 → 失败", () => {
        expect(() => SocialLinksSchema.parse(undefined)).toThrow(z.ZodError);
    });
});

describe("SocialLinksDefaultSchema", () => {
    it("未提供 → 默认 null", () => {
        expect(SocialLinksDefaultSchema.parse(undefined)).toBeNull();
    });
});
