/**
 * 评论相关 Zod Schema
 */
import * as z from "zod";

import { CommentStatusSchema, OptionalStringSchema } from "./common";

// ── 创建评论 ──

export const CreateCommentSchema = z.object({
    body: z.string().min(1, "评论内容不能为空"),
    parent_id: OptionalStringSchema,
    status: CommentStatusSchema.default("published"),
    is_public: z.boolean().default(true),
    show_on_profile: z.boolean().default(true),
});

export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

// ── 更新评论 ──

export const UpdateCommentSchema = z
    .object({
        body: z.string().min(1),
        status: CommentStatusSchema,
        is_public: z.boolean(),
        show_on_profile: z.boolean(),
    })
    .partial();

export type UpdateCommentInput = z.infer<typeof UpdateCommentSchema>;

// ── 评论预览 ──

export const CommentPreviewSchema = z.object({
    body: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});
