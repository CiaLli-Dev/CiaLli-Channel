/**
 * 文章相关 Zod Schema
 */
import * as z from "zod";

import { ARTICLE_TITLE_MAX, weightedCharLength } from "@/constants/text-limits";

import { OptionalStringSchema, TagsSchema } from "./common";

const ArticleTitleSchema = z
    .string()
    .min(1, "标题必填")
    .refine(
        (value) => weightedCharLength(value) <= ARTICLE_TITLE_MAX,
        `标题最多 ${ARTICLE_TITLE_MAX} 字符`,
    );

// ── 创建文章 ──

export const CreateArticleSchema = z.object({
    title: ArticleTitleSchema,
    body_markdown: z.string().min(1, "正文必填"),
    status: z.literal("published").default("published"),
    slug: OptionalStringSchema,
    summary: OptionalStringSchema,
    cover_file: OptionalStringSchema,
    cover_url: OptionalStringSchema,
    tags: TagsSchema,
    category: OptionalStringSchema,
    allow_comments: z.boolean().default(true),
    is_public: z.boolean().default(true),
});

export type CreateArticleInput = z.infer<typeof CreateArticleSchema>;

// ── 更新文章（PATCH，全部字段可选） ──

export const UpdateArticleSchema = z
    .object({
        title: ArticleTitleSchema,
        slug: OptionalStringSchema,
        summary: OptionalStringSchema,
        body_markdown: z.string().min(1),
        cover_file: OptionalStringSchema,
        cover_url: OptionalStringSchema,
        tags: TagsSchema,
        category: OptionalStringSchema,
        allow_comments: z.boolean(),
        status: z.literal("published"),
        is_public: z.boolean(),
    })
    .partial();

export type UpdateArticleInput = z.infer<typeof UpdateArticleSchema>;

// ── 预览 ──

export const ArticlePreviewSchema = z.object({
    body_markdown: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});
