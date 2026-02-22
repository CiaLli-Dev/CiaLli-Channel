/**
 * 管理后台相关 Zod Schema
 */
import * as z from "zod";

import {
    AppRoleSchema,
    OptionalStringSchema,
    SocialLinksSchema,
} from "./common";

// ── 管理员更新用户 ──

export const AdminUpdateUserSchema = z
    .object({
        // Directus 用户字段
        email: z.email(),
        first_name: OptionalStringSchema,
        last_name: OptionalStringSchema,
        role: OptionalStringSchema,
        password: z.string().min(1),
        // 档案字段
        username: z.string().min(1),
        display_name: z.string().min(1),
        bio: z.string().nullable(),
        bio_typewriter_enable: z.boolean(),
        bio_typewriter_speed: z.number().int().min(10).max(500),
        avatar_file: OptionalStringSchema,
        avatar_url: OptionalStringSchema,
        social_links: SocialLinksSchema,
        profile_public: z.boolean(),
        show_articles_on_profile: z.boolean(),
        show_diaries_on_profile: z.boolean(),
        show_bangumi_on_profile: z.boolean(),
        show_albums_on_profile: z.boolean(),
        show_comments_on_profile: z.boolean(),
        // 权限字段
        app_role: AppRoleSchema,
        can_publish_articles: z.boolean(),
        can_comment_articles: z.boolean(),
        can_manage_diaries: z.boolean(),
        can_comment_diaries: z.boolean(),
        can_manage_anime: z.boolean(),
        can_manage_albums: z.boolean(),
        can_upload_files: z.boolean(),
    })
    .partial();

export type AdminUpdateUserInput = z.infer<typeof AdminUpdateUserSchema>;

// ── 管理员重置密码 ──

export const AdminResetPasswordSchema = z.object({
    new_password: z.string().min(8, "密码至少 8 位").max(20, "密码不能超过 20 位"),
});

export type AdminResetPasswordInput = z.infer<typeof AdminResetPasswordSchema>;

// ── 管理员公告配置 ──

export const AdminBulletinUpdateSchema = z
    .object({
        title: OptionalStringSchema,
        summary: OptionalStringSchema,
        body_markdown: z.string().min(1, "公告正文不能为空"),
        closable: z.boolean(),
    })
    .partial();

export type AdminBulletinUpdateInput = z.infer<
    typeof AdminBulletinUpdateSchema
>;

export const AdminBulletinPreviewSchema = z.object({
    body_markdown: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});

export type AdminBulletinPreviewInput = z.infer<
    typeof AdminBulletinPreviewSchema
>;

// ── 管理员关于我们配置 ──

export const AdminAboutUpdateSchema = z.object({
    title: OptionalStringSchema,
    summary: OptionalStringSchema,
    body_markdown: z.string().trim().min(1, "关于页正文不能为空"),
});

export type AdminAboutUpdateInput = z.infer<typeof AdminAboutUpdateSchema>;

export const AdminAboutPreviewSchema = z.object({
    body_markdown: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});

export type AdminAboutPreviewInput = z.infer<typeof AdminAboutPreviewSchema>;
