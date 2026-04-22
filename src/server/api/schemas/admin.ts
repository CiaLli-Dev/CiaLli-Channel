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

type AdminSiteSettingsNavLinkInput =
    | number
    | {
          name: string;
          url: string;
          external?: boolean;
          icon?: string;
          children?: AdminSiteSettingsNavLinkInput[];
      };

export type AdminSiteSettingsPatchInput = {
    site?: {
        title?: string;
        subtitle?: string;
        lang?: "en" | "zh_CN" | "zh_TW" | "ja";
        timeZone?: string | null;
        themePreset?: "blue" | "purple" | "teal" | "orange";
        keywords?: string[];
        siteStartDate?: string | null;
        favicon?: {
            src: string;
            theme?: "light" | "dark";
            sizes?: string;
        }[];
    };
    auth?: {
        register_enabled?: boolean;
    };
    navbarTitle?: {
        mode?: "text-icon" | "logo";
        text?: string;
        icon?: string;
        logo?: string;
    };
    wallpaperMode?: {
        defaultMode?: "banner" | "none";
    };
    banner?: {
        src?: string | string[];
        position?: "top" | "center" | "bottom";
        carousel?: {
            enable?: boolean;
            interval?: number;
        };
        waves?: {
            enable?: boolean;
        };
        homeText?: {
            enable?: boolean;
            title?: string;
            subtitle?: string | string[];
            typewriter?: {
                enable?: boolean;
                speed?: number;
                deleteSpeed?: number;
                pauseTime?: number;
            };
        };
        navbar?: {
            transparentMode?: "semi" | "full" | "semifull";
        };
    };
    toc?: {
        enable?: boolean;
        mode?: "float" | "sidebar";
        depth?: number;
        useJapaneseBadge?: boolean;
    };
    navBar?: {
        links?: AdminSiteSettingsNavLinkInput[];
    };
    profile?: {
        avatar?: string;
    };
    musicPlayer?: {
        enable?: boolean;
        meting_api?: string;
        id?: string;
        server?: string;
        type?: string;
        marqueeSpeed?: number;
    };
    ai?: {
        enabled?: boolean;
        articleSummaryEnabled?: boolean;
        baseUrl?: string;
        model?: string;
        apiKeyEncrypted?: string | null;
        updatedAt?: string | null;
    };
};

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

export type AdminAiSettingsUpdateInput = {
    enabled?: boolean;
    articleSummaryEnabled?: boolean;
    baseUrl?: OptionalString;
    model?: OptionalString;
    apiKey?: OptionalString;
    clearApiKey?: boolean;
};

const StrictStringArraySchema = z.array(z.string());
const StrictAssetListSchema = z.array(z.string());

const StrictFaviconSchema = z
    .object({
        src: z.string(),
        theme: z.enum(["light", "dark"]).optional(),
        sizes: z.string().optional(),
    })
    .strict();

const StrictNavLinkSchema: z.ZodType<AdminSiteSettingsNavLinkInput> = z.lazy(
    () =>
        z.union([
            z.number().int(),
            z
                .object({
                    name: z.string(),
                    url: z.string(),
                    external: z.boolean().optional(),
                    icon: z.string().optional(),
                    children: z.array(StrictNavLinkSchema).optional(),
                })
                .strict(),
        ]),
);

export const AdminSiteSettingsPatchSchema: z.ZodType<AdminSiteSettingsPatchInput> =
    z
        .object({
            site: z
                .object({
                    title: z.string(),
                    subtitle: z.string(),
                    lang: z.enum(["en", "zh_CN", "zh_TW", "ja"]),
                    timeZone: z.string().nullable(),
                    themePreset: z.enum(["blue", "purple", "teal", "orange"]),
                    keywords: StrictStringArraySchema,
                    siteStartDate: z.string().nullable(),
                    favicon: z.array(StrictFaviconSchema),
                })
                .strict()
                .partial(),
            auth: z
                .object({
                    register_enabled: z.boolean(),
                })
                .strict()
                .partial(),
            navbarTitle: z
                .object({
                    mode: z.enum(["text-icon", "logo"]),
                    text: z.string(),
                    icon: z.string(),
                    logo: z.string(),
                })
                .strict()
                .partial(),
            wallpaperMode: z
                .object({
                    defaultMode: z.enum(["banner", "none"]),
                })
                .strict()
                .partial(),
            banner: z
                .object({
                    src: z.union([z.string(), StrictAssetListSchema]),
                    position: z.enum(["top", "center", "bottom"]),
                    carousel: z
                        .object({
                            enable: z.boolean(),
                            interval: z.coerce.number().int(),
                        })
                        .strict()
                        .partial(),
                    waves: z
                        .object({
                            enable: z.boolean(),
                        })
                        .strict()
                        .partial(),
                    homeText: z
                        .object({
                            enable: z.boolean(),
                            title: z.string(),
                            subtitle: z.union([
                                z.string(),
                                z.array(z.string()),
                            ]),
                            typewriter: z
                                .object({
                                    enable: z.boolean(),
                                    speed: z.coerce.number().int(),
                                    deleteSpeed: z.coerce.number().int(),
                                    pauseTime: z.coerce.number().int(),
                                })
                                .strict()
                                .partial(),
                        })
                        .strict()
                        .partial(),
                    navbar: z
                        .object({
                            transparentMode: z.enum([
                                "semi",
                                "full",
                                "semifull",
                            ]),
                        })
                        .strict()
                        .partial(),
                })
                .strict()
                .partial(),
            toc: z
                .object({
                    enable: z.boolean(),
                    mode: z.enum(["float", "sidebar"]),
                    depth: z.coerce.number().int(),
                    useJapaneseBadge: z.boolean(),
                })
                .strict()
                .partial(),
            navBar: z
                .object({
                    links: z.array(StrictNavLinkSchema),
                })
                .strict()
                .partial(),
            profile: z
                .object({
                    avatar: z.string(),
                })
                .strict()
                .partial(),
            musicPlayer: z
                .object({
                    enable: z.boolean(),
                    meting_api: z.string(),
                    id: z.string(),
                    server: z.string(),
                    type: z.string(),
                    marqueeSpeed: z.coerce.number().int(),
                })
                .strict()
                .partial(),
            ai: z
                .object({
                    enabled: z.boolean(),
                    articleSummaryEnabled: z.boolean(),
                    baseUrl: z.string(),
                    model: z.string(),
                    apiKeyEncrypted: z.string().nullable(),
                    updatedAt: z.string().nullable(),
                })
                .strict()
                .partial(),
        })
        .strict()
        .partial();

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

// ── 管理员 AI 配置 ──

export const AdminAiSettingsUpdateSchema: z.ZodType<AdminAiSettingsUpdateInput> =
    z
        .object({
            enabled: z.boolean(),
            articleSummaryEnabled: z.boolean(),
            baseUrl: OptionalStringSchema,
            model: OptionalStringSchema,
            apiKey: OptionalStringSchema,
            clearApiKey: z.boolean(),
        })
        .partial();
