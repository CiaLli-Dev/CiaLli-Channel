import { describe, it, expect } from "vitest";
import * as z from "zod";

import {
    CreateArticleSchema,
    UpdateArticleSchema,
} from "@/server/api/schemas/article";

describe("CreateArticleSchema", () => {
    it("缺 title → 失败", () => {
        expect(() =>
            CreateArticleSchema.parse({ body_markdown: "content" }),
        ).toThrow(z.ZodError);
    });

    it("缺 body_markdown → 失败", () => {
        expect(() => CreateArticleSchema.parse({ title: "Title" })).toThrow(
            z.ZodError,
        );
    });

    it("仅 title+body_markdown → 通过（使用默认值）", () => {
        const result = CreateArticleSchema.parse({
            title: "Test",
            body_markdown: "Content",
        });
        expect(result.title).toBe("Test");
        expect(result.body_markdown).toBe("Content");
        expect(result.status).toBe("published");
        expect(result.allow_comments).toBe(true);
        expect(result.is_public).toBe(true);
        expect(result.tags).toEqual([]);
    });

    it("status=draft → 失败", () => {
        expect(() =>
            CreateArticleSchema.parse({
                title: "Test",
                body_markdown: "Content",
                status: "draft",
            }),
        ).toThrow(z.ZodError);
    });

    it("完整输入", () => {
        const input = {
            title: "Full Article",
            body_markdown: "# Hello",
            status: "published" as const,
            slug: "full-article",
            summary: "A full article",
            cover_file: null,
            cover_url: "https://example.com/cover.jpg",
            tags: ["test", "demo"],
            category: "tech",
            allow_comments: false,
            is_public: false,
        };
        const result = CreateArticleSchema.parse(input);
        expect(result).toEqual(input);
    });

    it("标题超 30（中文按 2）→ 失败", () => {
        expect(() =>
            CreateArticleSchema.parse({
                title: "你".repeat(16),
                body_markdown: "Content",
            }),
        ).toThrow(z.ZodError);
    });
});

describe("UpdateArticleSchema", () => {
    it("空对象 → 通过（all partial）", () => {
        const result = UpdateArticleSchema.parse({});
        // tags 有 default([])，partial 后仍触发默认值
        expect(result.title).toBeUndefined();
        expect(result.body_markdown).toBeUndefined();
        expect(result.status).toBeUndefined();
    });

    it("部分更新", () => {
        const result = UpdateArticleSchema.parse({
            title: "Updated Title",
            status: "published",
        });
        expect(result.title).toBe("Updated Title");
        expect(result.status).toBe("published");
        expect(result.body_markdown).toBeUndefined();
    });

    it("status=draft → 失败", () => {
        expect(() =>
            UpdateArticleSchema.parse({
                status: "draft",
            }),
        ).toThrow(z.ZodError);
    });

    it("更新标题超 30（中文按 2）→ 失败", () => {
        expect(() =>
            UpdateArticleSchema.parse({
                title: "你".repeat(16),
            }),
        ).toThrow(z.ZodError);
    });
});
