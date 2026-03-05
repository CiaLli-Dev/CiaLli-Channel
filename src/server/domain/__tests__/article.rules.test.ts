import { describe, it, expect } from "vitest";

import {
    isArticlePubliclyVisible,
    canTransitionArticleStatus,
    isArticleCommentable,
    canUserModifyArticle,
    isOwner,
} from "../article/article.rules";

describe("isArticlePubliclyVisible", () => {
    it("published + is_public → true", () => {
        expect(
            isArticlePubliclyVisible({ status: "published", is_public: true }),
        ).toBe(true);
    });

    it("draft → false", () => {
        expect(
            isArticlePubliclyVisible({ status: "draft", is_public: true }),
        ).toBe(false);
    });
});

describe("canTransitionArticleStatus", () => {
    it("draft → published 合法", () => {
        expect(canTransitionArticleStatus("draft", "published")).toBe(true);
    });

    it("archived → published 不合法", () => {
        expect(canTransitionArticleStatus("archived", "published")).toBe(false);
    });
});

describe("isArticleCommentable", () => {
    it("公开可见 + allow_comments → true", () => {
        expect(
            isArticleCommentable({
                status: "published",
                is_public: true,
                allow_comments: true,
            }),
        ).toBe(true);
    });

    it("allow_comments=false → false", () => {
        expect(
            isArticleCommentable({
                status: "published",
                is_public: true,
                allow_comments: false,
            }),
        ).toBe(false);
    });

    it("不可见的文章 → 不可评论", () => {
        expect(
            isArticleCommentable({
                status: "draft",
                is_public: true,
                allow_comments: true,
            }),
        ).toBe(false);
    });
});

describe("canUserModifyArticle", () => {
    it("owner 可以修改", () => {
        expect(canUserModifyArticle("user-1", "user-1", false)).toBe(true);
    });

    it("非 owner 不可以修改", () => {
        expect(canUserModifyArticle("user-1", "user-2", false)).toBe(false);
    });

    it("admin 可以修改任何人的文章", () => {
        expect(canUserModifyArticle("admin-1", "user-2", true)).toBe(true);
    });
});

describe("isOwner", () => {
    it("viewerId === ownerId → true", () => {
        expect(isOwner("user-1", "user-1")).toBe(true);
    });

    it("viewerId !== ownerId → false", () => {
        expect(isOwner("user-1", "user-2")).toBe(false);
    });

    it("viewerId=null → false", () => {
        expect(isOwner(null, "user-1")).toBe(false);
    });
});
