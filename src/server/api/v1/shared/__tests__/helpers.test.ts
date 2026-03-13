import { describe, it, expect } from "vitest";

import {
    sanitizeSlug,
    isSpecialArticleSlug,
    toSpecialArticleSlug,
    excludeSpecialArticleSlugFilter,
    safeCsv,
    toDirectusAssetQuery,
} from "@/server/api/v1/shared/helpers";

// ── sanitizeSlug ──

describe("sanitizeSlug", () => {
    it("中文保留", () => {
        expect(sanitizeSlug("你好世界")).toBe("你好世界");
    });

    it("特殊字符清除", () => {
        expect(sanitizeSlug("hello@world!")).toBe("helloworld");
    });

    it("空格转连字符", () => {
        expect(sanitizeSlug("hello world")).toBe("hello-world");
    });

    it("连续连字符合并", () => {
        expect(sanitizeSlug("hello---world")).toBe("hello-world");
    });

    it("大写转小写", () => {
        expect(sanitizeSlug("Hello World")).toBe("hello-world");
    });

    it("空字符串 fallback 以 item- 开头", () => {
        const result = sanitizeSlug("   @#$   ");
        expect(result).toMatch(/^item-\d+$/);
    });
});

// ── isSpecialArticleSlug ──

describe("isSpecialArticleSlug", () => {
    it("about → true", () => {
        expect(isSpecialArticleSlug("about")).toBe(true);
    });
    it("friends → true", () => {
        expect(isSpecialArticleSlug("friends")).toBe(true);
    });
    it("普通 slug → false", () => {
        expect(isSpecialArticleSlug("my-post")).toBe(false);
    });
});

// ── toSpecialArticleSlug ──

describe("toSpecialArticleSlug", () => {
    it("about → 'about'", () => {
        expect(toSpecialArticleSlug("about")).toBe("about");
    });
    it("普通值 → null", () => {
        expect(toSpecialArticleSlug("normal")).toBe(null);
    });
    it("null → null", () => {
        expect(toSpecialArticleSlug(null)).toBe(null);
    });
    it("空字符串 → null", () => {
        expect(toSpecialArticleSlug("")).toBe(null);
    });
});

// ── excludeSpecialArticleSlugFilter ──

describe("excludeSpecialArticleSlugFilter", () => {
    it("返回排除特殊 slug 的过滤表达式", () => {
        expect(excludeSpecialArticleSlugFilter()).toEqual({
            _or: [
                { slug: { _null: true } },
                { slug: { _nin: ["about", "friends"] } },
            ],
        });
    });
});

// ── safeCsv ──

describe("safeCsv", () => {
    it("null → []", () => {
        expect(safeCsv(null)).toEqual([]);
    });
    it("undefined → []", () => {
        expect(safeCsv(undefined)).toEqual([]);
    });
    it("非数组 → []", () => {
        expect(safeCsv("not-array" as unknown as string[])).toEqual([]);
    });
    it("正常数组", () => {
        expect(safeCsv(["a", "b"])).toEqual(["a", "b"]);
    });
    it("含空白元素过滤", () => {
        expect(safeCsv(["a", "", "  ", "b"])).toEqual(["a", "b"]);
    });
});

// ── toDirectusAssetQuery ──

describe("toDirectusAssetQuery", () => {
    it("无参数 → {}", () => {
        expect(toDirectusAssetQuery(new URLSearchParams())).toEqual({});
    });

    it("width/height 正常", () => {
        const q = new URLSearchParams("width=200&height=100");
        expect(toDirectusAssetQuery(q)).toEqual({
            width: "200",
            height: "100",
        });
    });

    it("width 超限裁剪到 4096", () => {
        const q = new URLSearchParams("width=9999");
        expect(toDirectusAssetQuery(q).width).toBe("4096");
    });

    it("fit 白名单", () => {
        const q = new URLSearchParams("fit=cover");
        expect(toDirectusAssetQuery(q).fit).toBe("cover");
    });

    it("fit 非法忽略", () => {
        const q = new URLSearchParams("fit=invalid");
        expect(toDirectusAssetQuery(q).fit).toBeUndefined();
    });

    it("quality 裁剪到 1-100", () => {
        const q = new URLSearchParams("quality=150");
        expect(toDirectusAssetQuery(q).quality).toBe("100");
    });

    it("format 白名单", () => {
        const q = new URLSearchParams("format=webp");
        expect(toDirectusAssetQuery(q).format).toBe("webp");
    });

    it("format 非法忽略", () => {
        const q = new URLSearchParams("format=gif");
        expect(toDirectusAssetQuery(q).format).toBeUndefined();
    });
});
