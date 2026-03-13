/**
 * 日记相关 Zod Schema
 */
import * as z from "zod";

import {
    AppStatusSchema,
    OptionalIntSchema,
    OptionalStringSchema,
} from "./common";

// ── 创建日记 ──

export const CreateDiarySchema = z.object({
    content: z.string().min(1, "日记内容必填"),
    status: z.literal("published").default("published"),
    allow_comments: z.boolean().default(true),
    praviate: z.boolean().default(true),
});

export type CreateDiaryInput = z.infer<typeof CreateDiarySchema>;

// ── 更新日记 ──

export const UpdateDiarySchema = z
    .object({
        content: z.string().min(1),
        allow_comments: z.boolean(),
        praviate: z.boolean(),
    })
    .partial();

export type UpdateDiaryInput = z.infer<typeof UpdateDiarySchema>;

// ── 日记预览 ──

export const DiaryPreviewSchema = z.object({
    content: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});

// ── 创建日记图片 ──

export const CreateDiaryImageSchema = z.object({
    file_id: OptionalStringSchema,
    image_url: OptionalStringSchema,
    caption: OptionalStringSchema,
    sort: OptionalIntSchema,
    is_public: z.boolean().default(true),
    show_on_profile: z.boolean().default(true),
});

export type CreateDiaryImageInput = z.infer<typeof CreateDiaryImageSchema>;

// ── 更新日记图片 ──

export const UpdateDiaryImageSchema = z
    .object({
        file_id: OptionalStringSchema,
        image_url: OptionalStringSchema,
        caption: OptionalStringSchema,
        sort: OptionalIntSchema,
        is_public: z.boolean(),
        show_on_profile: z.boolean(),
        status: AppStatusSchema,
    })
    .partial();

export type UpdateDiaryImageInput = z.infer<typeof UpdateDiaryImageSchema>;
