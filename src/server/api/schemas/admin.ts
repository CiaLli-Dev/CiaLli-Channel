/**
 * 管理后台相关 Zod Schema
 */
import * as z from "zod";

import {
    type AppRole,
    type OptionalString,
    type SocialLinks,
    AppRoleSchema,
    OptionalStringSchema,
    SocialLinksSchema,
} from "./common";

export type AdminUpdateUserInput = {
    email?: string;
    first_name?: OptionalString;
    last_name?: OptionalString;
    role?: OptionalString;
    password?: string;
    username?: string;
    display_name?: string;
    bio?: string | null;
    avatar_file?: OptionalString;
    social_links?: SocialLinks;
    profile_public?: boolean;
    show_articles_on_profile?: boolean;
    show_diaries_on_profile?: boolean;
    show_bangumi_on_profile?: boolean;
    show_albums_on_profile?: boolean;
    show_comments_on_profile?: boolean;
    app_role?: AppRole;
    can_publish_articles?: boolean;
    can_comment_articles?: boolean;
    can_manage_diaries?: boolean;
    can_comment_diaries?: boolean;
    can_manage_albums?: boolean;
    can_upload_files?: boolean;
};

export type AdminResetPasswordInput = {
    new_password: string;
};

export type AdminBulletinUpdateInput = {
    title?: OptionalString;
    summary?: OptionalString;
    body_markdown?: string;
    closable?: boolean;
};

export type AdminBulletinPreviewInput = {
    body_markdown: string;
    render_mode: "fast" | "full";
};

export type AdminAboutUpdateInput = {
    title?: OptionalString;
    summary?: OptionalString;
    body_markdown: string;
};

export type AdminAboutPreviewInput = {
    body_markdown: string;
    render_mode: "fast" | "full";
};

// ── 管理员更新用户 ──

export const AdminUpdateUserSchema: z.ZodType<AdminUpdateUserInput> = z
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
        avatar_file: OptionalStringSchema,
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
        can_manage_albums: z.boolean(),
        can_upload_files: z.boolean(),
    })
    .partial();

// ── 管理员重置密码 ──

export const AdminResetPasswordSchema: z.ZodType<AdminResetPasswordInput> =
    z.object({
        new_password: z
            .string()
            .min(8, "密码至少 8 位")
            .max(20, "密码不能超过 20 位"),
    });

// ── 管理员公告配置 ──

export const AdminBulletinUpdateSchema: z.ZodType<AdminBulletinUpdateInput> = z
    .object({
        title: OptionalStringSchema,
        summary: OptionalStringSchema,
        body_markdown: z.string().min(1, "公告正文不能为空"),
        closable: z.boolean(),
    })
    .partial();

export const AdminBulletinPreviewSchema: z.ZodType<AdminBulletinPreviewInput> =
    z.object({
        body_markdown: z.string(),
        render_mode: z.enum(["fast", "full"]).default("full"),
    });

// ── 管理员关于我们配置 ──

export const AdminAboutUpdateSchema: z.ZodType<AdminAboutUpdateInput> =
    z.object({
        title: OptionalStringSchema,
        summary: OptionalStringSchema,
        body_markdown: z.string().trim().min(1, "关于页正文不能为空"),
    });

export const AdminAboutPreviewSchema: z.ZodType<AdminAboutPreviewInput> =
    z.object({
        body_markdown: z.string(),
        render_mode: z.enum(["fast", "full"]).default("full"),
    });
