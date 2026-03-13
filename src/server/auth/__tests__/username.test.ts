import { describe, it, expect } from "vitest";

import {
    normalizeRequestedUsername,
    normalizeAutoUsername,
    composeUsernameWithSuffix,
    validateDisplayName,
    truncateUsernameByWeight,
} from "@/server/auth/username";
import { AppError } from "@/server/api/errors";

// ── normalizeRequestedUsername ──

describe("normalizeRequestedUsername", () => {
    it("空 → 抛出 USERNAME_EMPTY", () => {
        expect(() => normalizeRequestedUsername("")).toThrow(AppError);
        try {
            normalizeRequestedUsername("");
        } catch (error) {
            expect((error as AppError).code).toBe("USERNAME_EMPTY");
        }
    });

    it("含非法字符 → 抛出 USERNAME_INVALID", () => {
        expect(() => normalizeRequestedUsername("用户名")).toThrow(AppError);
        try {
            normalizeRequestedUsername("user@name");
        } catch (error) {
            expect((error as AppError).code).toBe("USERNAME_INVALID");
        }
    });

    it("超长 → 抛出 USERNAME_TOO_LONG", () => {
        expect(() => normalizeRequestedUsername("a".repeat(15))).toThrow(
            AppError,
        );
    });

    it("正常值", () => {
        expect(normalizeRequestedUsername("test_user")).toBe("test_user");
        expect(normalizeRequestedUsername("  hello  ")).toBe("hello");
    });

    it("允许大写字母", () => {
        expect(normalizeRequestedUsername("TestUser")).toBe("TestUser");
    });
});

// ── normalizeAutoUsername ──

describe("normalizeAutoUsername", () => {
    it("CJK 替换为 -", () => {
        const result = normalizeAutoUsername("hello你好world");
        expect(result).not.toContain("你");
        expect(result).toContain("hello");
    });

    it("空 → user", () => {
        expect(normalizeAutoUsername("")).toBe("user");
    });

    it("截断到 14 权重", () => {
        const result = normalizeAutoUsername("a".repeat(20));
        expect(result.length).toBeLessThanOrEqual(14);
    });

    it("小写转换", () => {
        expect(normalizeAutoUsername("HELLO")).toBe("hello");
    });
});

// ── composeUsernameWithSuffix ──

describe("composeUsernameWithSuffix", () => {
    it("空 suffix → 截断 base", () => {
        const result = composeUsernameWithSuffix("longusername", "");
        expect(result).toBe("longusername");
    });

    it("有 suffix → 计算预算", () => {
        const result = composeUsernameWithSuffix("username", "-123");
        expect(result).toContain("-123");
        expect(result.length).toBeLessThanOrEqual(14);
    });

    it("base 空时用 u 做 fallback", () => {
        const result = composeUsernameWithSuffix("---", "-123");
        expect(result).toContain("u");
        expect(result).toContain("-123");
    });
});

// ── validateDisplayName ──

describe("validateDisplayName", () => {
    it("空 → 抛出 DISPLAY_NAME_EMPTY", () => {
        expect(() => validateDisplayName("")).toThrow(AppError);
        try {
            validateDisplayName("");
        } catch (error) {
            expect((error as AppError).code).toBe("DISPLAY_NAME_EMPTY");
        }
    });

    it("控制字符 → 抛出 DISPLAY_NAME_INVALID", () => {
        expect(() => validateDisplayName("hello\x00world")).toThrow(AppError);
    });

    it("超长 → 抛出 DISPLAY_NAME_TOO_LONG", () => {
        // 11 个中文 = 22 权重 > 20
        expect(() => validateDisplayName("一二三四五六七八九十一")).toThrow(
            AppError,
        );
    });

    it("正常值", () => {
        expect(validateDisplayName("Hello")).toBe("Hello");
        expect(validateDisplayName("  Alice  ")).toBe("Alice");
    });

    it("中文名刚好不超限", () => {
        // 10 个中文 = 20 权重 = 恰好等于上限
        const name = "一二三四五六七八九十";
        expect(validateDisplayName(name)).toBe(name);
    });
});

// ── truncateUsernameByWeight ──

describe("truncateUsernameByWeight", () => {
    it("不超限 → 全部保留", () => {
        expect(truncateUsernameByWeight("hello", 10)).toBe("hello");
    });

    it("超限 → 截断", () => {
        expect(truncateUsernameByWeight("abcdef", 3)).toBe("abc");
    });

    it("CJK 中断", () => {
        // "ab你" 权重 = 1+1+2=4, maxWeight=3 → 只保留 "ab"
        expect(truncateUsernameByWeight("ab你", 3)).toBe("ab");
    });

    it("maxWeight=0 → 空字符串", () => {
        expect(truncateUsernameByWeight("hello", 0)).toBe("");
    });
});
