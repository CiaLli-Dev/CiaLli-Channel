/**
 * 文章相关 Zod Schema
 */
import * as z from "zod";

import { ARTICLE_TITLE_MAX, weightedCharLength } from "@/constants/text-limits";

import {
    AppStatusSchema,
    OptionalStringSchema,
    TagsDefaultSchema,
    TagsSchema,
} from "./common";

const ArticleTitleLengthSchema = z
    .string()
    .refine(
        (value) => weightedCharLength(value) <= ARTICLE_TITLE_MAX,
        `标题最多 ${ARTICLE_TITLE_MAX} 字符`,
    );

const ArticleTitleSchema = z
    .string()
    .min(1, "标题必填")
    .pipe(ArticleTitleLengthSchema);

const DraftTagsSchema = z.array(z.string().max(100)).max(20).optional();

// ── 创建文章 ──

export const CreateArticleSchema = z.object({
    title: ArticleTitleSchema,
    body_markdown: z.string().min(1, "正文必填"),
    status: z.literal("published").default("published"),
    slug: OptionalStringSchema,
    summary: OptionalStringSchema,
    cover_file: OptionalStringSchema,
    cover_url: OptionalStringSchema,
    tags: TagsDefaultSchema,
    category: OptionalStringSchema,
    allow_comments: z.boolean().default(true),
    is_public: z.boolean().default(true),
});

export type CreateArticleInput = z.infer<typeof CreateArticleSchema>;

// ── 更新文章（PATCH，全部字段可选） ──

export const UpdateArticleSchema = z
    .object({
        title: ArticleTitleLengthSchema,
        slug: OptionalStringSchema,
        summary: OptionalStringSchema,
        body_markdown: z.string(),
        cover_file: OptionalStringSchema,
        cover_url: OptionalStringSchema,
        tags: TagsSchema,
        category: OptionalStringSchema,
        allow_comments: z.boolean(),
        status: AppStatusSchema,
        is_public: z.boolean(),
    })
    .partial();

export type UpdateArticleInput = z.infer<typeof UpdateArticleSchema>;

// ── 工作草稿（允许未完成字段） ──

export const UpsertWorkingDraftSchema = z.object({
    title: ArticleTitleLengthSchema.optional(),
    summary: OptionalStringSchema,
    body_markdown: z.string().optional(),
    cover_file: OptionalStringSchema,
    cover_url: OptionalStringSchema,
    tags: DraftTagsSchema,
    category: OptionalStringSchema,
    allow_comments: z.boolean().optional(),
    is_public: z.boolean().optional(),
});

export type UpsertWorkingDraftInput = z.infer<typeof UpsertWorkingDraftSchema>;

// ── 预览 ──

export const ArticlePreviewSchema = z.object({
    body_markdown: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});
