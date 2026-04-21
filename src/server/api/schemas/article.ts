/**
 * 文章相关 Zod Schema
 */
import * as z from "zod";

import { ARTICLE_TITLE_MAX, weightedCharLength } from "@/constants/text-limits";

import {
    type AppStatus,
    type OptionalString,
    type Tags,
    AppStatusSchema,
    OptionalStringSchema,
    TagsDefaultSchema,
    TagsSchema,
} from "./common";

export type CreateArticleInput = {
    title: string;
    body_markdown: string;
    status: "published";
    slug?: OptionalString;
    summary?: OptionalString;
    ai_summary_enabled?: boolean;
    cover_file?: OptionalString;
    cover_url?: OptionalString;
    tags: Tags;
    category?: OptionalString;
    allow_comments: boolean;
    is_public: boolean;
};

export type UpdateArticleInput = {
    title?: string;
    slug?: OptionalString;
    summary?: OptionalString;
    ai_summary_enabled?: boolean;
    body_markdown?: string;
    cover_file?: OptionalString;
    cover_url?: OptionalString;
    tags?: Tags;
    category?: OptionalString;
    allow_comments?: boolean;
    status?: AppStatus;
    is_public?: boolean;
};

export type UpsertWorkingDraftInput = {
    title?: string;
    summary?: OptionalString;
    ai_summary_enabled?: boolean;
    body_markdown?: string;
    cover_file?: OptionalString;
    cover_url?: OptionalString;
    tags?: Tags;
    category?: OptionalString;
    allow_comments?: boolean;
    is_public?: boolean;
};

export type ArticlePreviewInput = {
    body_markdown: string;
    render_mode: "fast" | "full";
};

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

export const CreateArticleSchema: z.ZodType<CreateArticleInput> = z.object({
    title: ArticleTitleSchema,
    body_markdown: z.string().min(1, "正文必填"),
    status: z.literal("published").default("published"),
    slug: OptionalStringSchema,
    summary: OptionalStringSchema,
    ai_summary_enabled: z.boolean().optional(),
    cover_file: OptionalStringSchema,
    cover_url: OptionalStringSchema,
    tags: TagsDefaultSchema,
    category: OptionalStringSchema,
    allow_comments: z.boolean().default(true),
    is_public: z.boolean().default(true),
});

// ── 更新文章（PATCH，全部字段可选） ──

export const UpdateArticleSchema: z.ZodType<UpdateArticleInput> = z
    .object({
        title: ArticleTitleLengthSchema,
        slug: OptionalStringSchema,
        summary: OptionalStringSchema,
        ai_summary_enabled: z.boolean(),
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

// ── 工作草稿（允许未完成字段） ──

export const UpsertWorkingDraftSchema: z.ZodType<UpsertWorkingDraftInput> =
    z.object({
        title: ArticleTitleLengthSchema.optional(),
        summary: OptionalStringSchema,
        ai_summary_enabled: z.boolean().optional(),
        body_markdown: z.string().optional(),
        cover_file: OptionalStringSchema,
        cover_url: OptionalStringSchema,
        tags: DraftTagsSchema,
        category: OptionalStringSchema,
        allow_comments: z.boolean().optional(),
        is_public: z.boolean().optional(),
    });

// ── 预览 ──

export const ArticlePreviewSchema: z.ZodType<ArticlePreviewInput> = z.object({
    body_markdown: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});
