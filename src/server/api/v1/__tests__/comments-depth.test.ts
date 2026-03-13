import { describe, expect, it } from "vitest";

import {
    canCreateReplyAtDepth,
    parseCommentPagination,
} from "@/server/api/v1/comments";

describe("canCreateReplyAtDepth", () => {
    it("父级深度为 0 时允许回复", () => {
        expect(canCreateReplyAtDepth(0)).toBe(true);
    });

    it("父级深度为 1 时允许回复", () => {
        expect(canCreateReplyAtDepth(1)).toBe(true);
    });

    it("父级深度为 2 时禁止回复", () => {
        expect(canCreateReplyAtDepth(2)).toBe(false);
    });

    it("父级深度大于 2 时禁止回复", () => {
        expect(canCreateReplyAtDepth(3)).toBe(false);
    });
});

describe("parseCommentPagination", () => {
    it("默认返回第一页与默认分页大小", () => {
        const url = new URL("https://example.com/api/v1/articles/1/comments");
        expect(parseCommentPagination(url)).toEqual({
            page: 1,
            limit: 20,
            offset: 0,
        });
    });

    it("对非法参数回退为默认值", () => {
        const url = new URL(
            "https://example.com/api/v1/articles/1/comments?page=-10&limit=NaN",
        );
        expect(parseCommentPagination(url)).toEqual({
            page: 1,
            limit: 20,
            offset: 0,
        });
    });

    it("限制最大分页大小为 50", () => {
        const url = new URL(
            "https://example.com/api/v1/articles/1/comments?page=3&limit=200",
        );
        expect(parseCommentPagination(url)).toEqual({
            page: 3,
            limit: 50,
            offset: 100,
        });
    });
});
