/**
 * 通用 Zod Schema 定义
 *
 * 全局共享的枚举、分页、可见性、社交链接等 schema。
 */
import * as z from "zod";

// ── 枚举 ──

export const AppStatusSchema = z.enum(["draft", "published", "archived"]);
export const CommentStatusSchema = z.enum(["published", "hidden", "archived"]);
export const WatchStatusSchema = z.enum([
    "watching",
    "completed",
    "planned",
    "onhold",
    "dropped",
]);
export const AlbumLayoutSchema = z.enum(["grid", "masonry"]);
export const AppRoleSchema = z.enum(["admin", "member"]);
export const RegistrationRequestStatusSchema = z.enum([
    "pending",
    "approved",
    "rejected",
    "cancelled",
]);

// ── 分页 ──

export const PaginationSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});

// ── 可见性 PATCH ──

export const VisibilityPatchSchema = z
    .object({
        status: AppStatusSchema,
        is_public: z.boolean(),
        show_on_profile: z.boolean(),
    })
    .partial();

// ── 社交链接 ──

export const SocialLinkSchema = z.object({
    platform: z.string().min(1).max(50),
    url: z
        .string()
        .max(500)
        .refine((val) => /^https?:\/\//.test(val) || /^mailto:/.test(val), {
            message: "链接仅支持 http/https/mailto 协议",
        }),
    enabled: z.boolean().default(true),
});

/**
 * PATCH 场景必须使用无默认值 schema，避免 default 在 partial() 下把缺省字段误解析成显式写入。
 */
export const SocialLinksSchema = z.array(SocialLinkSchema).max(20).nullable();
export const SocialLinksDefaultSchema = SocialLinksSchema.default(null);

// ── 标签 ──

export const TagsSchema = z.array(z.string().max(100)).max(20);
export const TagsDefaultSchema = TagsSchema.default([]);

// ── 通用字段 ──

/** 可选字符串（null 或 string） */
export const OptionalStringSchema = z.string().nullable().optional();

/** 正整数或 null */
export const OptionalIntSchema = z.number().int().nullable().optional();
