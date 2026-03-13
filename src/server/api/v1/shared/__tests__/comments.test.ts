import { describe, it, expect } from "vitest";

import { buildCommentTree } from "@/server/api/v1/shared/comments";
import type { AuthorBundleItem } from "@/server/api/v1/shared/author-cache";

// ── 辅助构造 ──

function makeComment(overrides: Record<string, unknown> = {}) {
    return {
        id: "c1",
        article_id: "a1",
        author_id: "user-1",
        parent_id: null as string | null,
        body: "hello",
        status: "published" as const,
        is_public: true,
        show_on_profile: true,
        date_created: "2026-01-01T00:00:00.000Z",
        date_updated: null,
        ...overrides,
    };
}

function makeAuthorMap(
    entries: Array<[string, AuthorBundleItem]> = [],
): Map<string, AuthorBundleItem> {
    return new Map(entries);
}

// ── buildCommentTree ──

describe("buildCommentTree", () => {
    it("空输入 → 空数组", () => {
        expect(buildCommentTree([], makeAuthorMap())).toEqual([]);
    });

    it("平铺评论按时间排序", () => {
        const comments = [
            makeComment({
                id: "c2",
                date_created: "2026-01-02T00:00:00.000Z",
            }),
            makeComment({
                id: "c1",
                date_created: "2026-01-01T00:00:00.000Z",
            }),
        ];
        const tree = buildCommentTree(comments, makeAuthorMap());
        expect(tree).toHaveLength(2);
        expect(tree[0].id).toBe("c1");
        expect(tree[1].id).toBe("c2");
    });

    it("嵌套回复挂载到 replies", () => {
        const comments = [
            makeComment({ id: "root", parent_id: null }),
            makeComment({ id: "reply", parent_id: "root" }),
        ];
        const tree = buildCommentTree(comments, makeAuthorMap());
        expect(tree).toHaveLength(1);
        expect(tree[0].id).toBe("root");
        expect(tree[0].replies).toHaveLength(1);
        expect(tree[0].replies[0].id).toBe("reply");
    });

    it("支持三级嵌套挂载", () => {
        const comments = [
            makeComment({ id: "root", parent_id: null }),
            makeComment({ id: "reply-1", parent_id: "root" }),
            makeComment({ id: "reply-2", parent_id: "reply-1" }),
        ];
        const tree = buildCommentTree(comments, makeAuthorMap());
        expect(tree).toHaveLength(1);
        expect(tree[0].replies).toHaveLength(1);
        expect(tree[0].replies[0].id).toBe("reply-1");
        expect(tree[0].replies[0].replies).toHaveLength(1);
        expect(tree[0].replies[0].replies[0].id).toBe("reply-2");
    });

    it("父评论缺失时回退为根节点", () => {
        const comments = [
            makeComment({ id: "orphan", parent_id: "missing-parent" }),
            makeComment({ id: "root", parent_id: null }),
        ];
        const tree = buildCommentTree(comments, makeAuthorMap());
        expect(tree).toHaveLength(2);
        expect(tree.some((item) => item.id === "orphan")).toBe(true);
        expect(tree.some((item) => item.id === "root")).toBe(true);
    });

    it("authorMap 命中", () => {
        const authorMap = makeAuthorMap([
            ["user-1", { id: "user-1", name: "Alice" }],
        ]);
        const comments = [makeComment({ author_id: "user-1" })];
        const tree = buildCommentTree(comments, authorMap);
        expect(tree[0].author.name).toBe("Alice");
    });

    it("authorMap 未命中 → fallback author", () => {
        const comments = [makeComment({ author_id: "unknown-user-id-long" })];
        const tree = buildCommentTree(comments, makeAuthorMap());
        expect(tree[0].author.name).toBe("user-unknown-");
    });

    it("解码普通文本", () => {
        const comments = [makeComment({ body: "普通文本" })];
        const tree = buildCommentTree(comments, makeAuthorMap());
        expect(tree[0].body).toBe("普通文本");
    });

    it("解码 base64 前缀", () => {
        const text = "Hello World";
        const encoded = Buffer.from(text).toString("base64");
        const comments = [makeComment({ body: `__DC_UTF8_B64__:${encoded}` })];
        const tree = buildCommentTree(comments, makeAuthorMap());
        expect(tree[0].body).toBe("Hello World");
    });

    it("空 base64 内容 → 空字符串", () => {
        const body = "__DC_UTF8_B64__:";
        const comments = [makeComment({ body })];
        const tree = buildCommentTree(comments, makeAuthorMap());
        expect(tree[0].body).toBe("");
    });
});
