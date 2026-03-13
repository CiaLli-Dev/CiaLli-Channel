import { describe, it, expect } from "vitest";

import {
    parseRouteId,
    parseProfileBioField,
    parseProfileTypewriterSpeedField,
    parseSocialLinks,
    parseVisibilityPatch,
} from "@/server/api/v1/shared/parse";
import { AppError } from "@/server/api/errors";

// ── parseRouteId ──

describe("parseRouteId", () => {
    it("正常值", () => {
        expect(parseRouteId("abc-123")).toBe("abc-123");
    });
    it("undefined → 空字符串", () => {
        expect(parseRouteId(undefined)).toBe("");
    });
    it("空字符串 → 空字符串", () => {
        expect(parseRouteId("")).toBe("");
    });
    it("trim 空白", () => {
        expect(parseRouteId("  id  ")).toBe("id");
    });
});

// ── parseProfileBioField ──

describe("parseProfileBioField", () => {
    it("null → null", () => {
        expect(parseProfileBioField(null)).toBe(null);
    });
    it("空字符串 → null", () => {
        expect(parseProfileBioField("")).toBe(null);
    });
    it("正常值", () => {
        expect(parseProfileBioField("hello")).toBe("hello");
    });
    it("超长抛出 PROFILE_BIO_TOO_LONG（CJK 加权）", () => {
        // 16 个中文字符 = 32 权重 > 30
        const longBio = "一二三四五六七八九十一二三四五六";
        expect(() => parseProfileBioField(longBio)).toThrow(AppError);
        try {
            parseProfileBioField(longBio);
        } catch (error) {
            expect((error as AppError).code).toBe("PROFILE_BIO_TOO_LONG");
        }
    });
    it("CJK 刚好不超限", () => {
        // 15 个中文 = 30 权重 = 恰好等于上限
        const bio = "一二三四五六七八九十一二三四五";
        expect(parseProfileBioField(bio)).toBe(bio);
    });
});

// ── parseProfileTypewriterSpeedField ──

describe("parseProfileTypewriterSpeedField", () => {
    it("undefined → 默认 80", () => {
        expect(parseProfileTypewriterSpeedField(undefined)).toBe(80);
    });
    it("5 → 10（最小值）", () => {
        expect(parseProfileTypewriterSpeedField(5)).toBe(10);
    });
    it("600 → 500（最大值）", () => {
        expect(parseProfileTypewriterSpeedField(600)).toBe(500);
    });
    it("100 → 100", () => {
        expect(parseProfileTypewriterSpeedField(100)).toBe(100);
    });
    it("小数向下取整", () => {
        expect(parseProfileTypewriterSpeedField(99.9)).toBe(99);
    });
});

// ── parseSocialLinks ──

describe("parseSocialLinks", () => {
    it("null → null", () => {
        expect(parseSocialLinks(null)).toBe(null);
    });
    it("undefined → null", () => {
        expect(parseSocialLinks(undefined)).toBe(null);
    });
    it("非数组 → 抛出", () => {
        expect(() => parseSocialLinks("not-array")).toThrow(AppError);
    });
    it("超 20 条 → 抛出 SOCIAL_LINKS_TOO_MANY", () => {
        const links = Array.from({ length: 21 }, (_, i) => ({
            platform: `p${i}`,
            url: `https://example.com/${i}`,
        }));
        expect(() => parseSocialLinks(links)).toThrow(AppError);
    });
    it("正常", () => {
        const links = [{ platform: "github", url: "https://github.com" }];
        const result = parseSocialLinks(links);
        expect(result).toEqual([
            { platform: "github", url: "https://github.com", enabled: true },
        ]);
    });
    it("缺失 platform/url 的条目被跳过", () => {
        const links = [
            { platform: "", url: "https://example.com" },
            { platform: "github", url: "" },
            { platform: "twitter", url: "https://x.com" },
        ];
        const result = parseSocialLinks(links);
        expect(result).toHaveLength(1);
        expect(result![0].platform).toBe("twitter");
    });
    it("URL 超 500 字符 → 抛出", () => {
        const links = [{ platform: "test", url: "https://" + "a".repeat(500) }];
        expect(() => parseSocialLinks(links)).toThrow(AppError);
    });
    it("enabled 默认为 true", () => {
        const links = [{ platform: "github", url: "https://github.com" }];
        expect(parseSocialLinks(links)![0].enabled).toBe(true);
    });
    it("enabled 显式为 false", () => {
        const links = [
            {
                platform: "github",
                url: "https://github.com",
                enabled: false,
            },
        ];
        expect(parseSocialLinks(links)![0].enabled).toBe(false);
    });
});

// ── parseVisibilityPatch ──

describe("parseVisibilityPatch", () => {
    it("空 body → 空对象", () => {
        expect(parseVisibilityPatch({})).toEqual({});
    });
    it("status 字段", () => {
        const result = parseVisibilityPatch({ status: "published" });
        expect(result.status).toBe("published");
    });
    it("is_public 字段", () => {
        const result = parseVisibilityPatch({ is_public: true });
        expect(result.is_public).toBe(true);
    });
    it("show_on_profile 字段", () => {
        const result = parseVisibilityPatch({ show_on_profile: false });
        expect(result.show_on_profile).toBe(false);
    });
    it("多字段组合", () => {
        const result = parseVisibilityPatch({
            status: "draft",
            is_public: false,
            show_on_profile: true,
        });
        expect(result).toEqual({
            status: "draft",
            is_public: false,
            show_on_profile: true,
        });
    });
});
