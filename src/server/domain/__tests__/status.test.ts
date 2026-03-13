import { describe, it, expect } from "vitest";

import { isValidTransition, getValidTargets } from "../shared/status";

describe("isValidTransition", () => {
    it("draft → published 合法", () => {
        expect(isValidTransition("draft", "published")).toBe(true);
    });

    it("draft → archived 合法", () => {
        expect(isValidTransition("draft", "archived")).toBe(true);
    });

    it("published → draft 合法（撤回）", () => {
        expect(isValidTransition("published", "draft")).toBe(true);
    });

    it("published → archived 合法", () => {
        expect(isValidTransition("published", "archived")).toBe(true);
    });

    it("archived → draft 合法（恢复）", () => {
        expect(isValidTransition("archived", "draft")).toBe(true);
    });

    it("archived → published 不合法", () => {
        expect(isValidTransition("archived", "published")).toBe(false);
    });

    it("相同状态 → 合法", () => {
        expect(isValidTransition("draft", "draft")).toBe(true);
        expect(isValidTransition("published", "published")).toBe(true);
        expect(isValidTransition("archived", "archived")).toBe(true);
    });
});

describe("getValidTargets", () => {
    it("draft 可转换到 published 和 archived", () => {
        const targets = getValidTargets("draft");
        expect(targets).toContain("published");
        expect(targets).toContain("archived");
        expect(targets).toHaveLength(2);
    });

    it("published 可转换到 draft 和 archived", () => {
        const targets = getValidTargets("published");
        expect(targets).toContain("draft");
        expect(targets).toContain("archived");
        expect(targets).toHaveLength(2);
    });

    it("archived 只能转换到 draft", () => {
        const targets = getValidTargets("archived");
        expect(targets).toEqual(["draft"]);
    });
});
