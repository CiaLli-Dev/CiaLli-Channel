import { describe, expect, it } from "vitest";

import {
    getHistoryStateIndex,
    getPopstateRollbackDelta,
    isModifiedPrimaryClick,
    isSameDocumentHashNavigation,
    shouldIgnoreAnchorNavigation,
} from "@/scripts/unsaved-changes-guard-helpers";

describe("unsaved-changes-guard helpers", () => {
    it("提取 Astro history index 时会严格校验数值类型", () => {
        expect(getHistoryStateIndex({ index: 3 })).toBe(3);
        expect(getHistoryStateIndex({ index: "3" })).toBeNull();
        expect(getHistoryStateIndex(null)).toBeNull();
    });

    it("能识别需要跳过的修饰点击", () => {
        expect(
            isModifiedPrimaryClick({
                button: 0,
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
            }),
        ).toBe(false);
        expect(
            isModifiedPrimaryClick({
                button: 1,
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
            }),
        ).toBe(true);
        expect(
            isModifiedPrimaryClick({
                button: 0,
                metaKey: false,
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
            }),
        ).toBe(true);
    });

    it("只把当前文档的 hash 导航视为无需离页确认", () => {
        expect(
            isSameDocumentHashNavigation(
                "https://example.com/posts/new",
                "https://example.com/posts/new#toolbar",
            ),
        ).toBe(true);
        expect(
            isSameDocumentHashNavigation(
                "https://example.com/posts/new",
                "https://example.com/",
            ),
        ).toBe(false);
    });

    it("下载链接和非 _self target 会跳过客户端守卫", () => {
        expect(
            shouldIgnoreAnchorNavigation({
                hasDownload: true,
                target: "",
            }),
        ).toBe(true);
        expect(
            shouldIgnoreAnchorNavigation({
                hasDownload: false,
                target: "_blank",
            }),
        ).toBe(true);
        expect(
            shouldIgnoreAnchorNavigation({
                hasDownload: false,
                target: "_self",
            }),
        ).toBe(false);
    });

    it("浏览器前进后退回滚方向会与目标 history index 对齐", () => {
        expect(getPopstateRollbackDelta(2, 1)).toBe(1);
        expect(getPopstateRollbackDelta(2, 3)).toBe(-1);
        expect(getPopstateRollbackDelta(2, 2)).toBeNull();
        expect(getPopstateRollbackDelta(null, 1)).toBeNull();
    });
});
