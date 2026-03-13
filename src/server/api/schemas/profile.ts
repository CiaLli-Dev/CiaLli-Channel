/**
 * 用户档案相关 Zod Schema
 */
import * as z from "zod";

import { OptionalStringSchema, SocialLinksSchema } from "./common";

const OptionalBangumiIdSchema = z
    .string()
    .trim()
    .regex(/^[0-9]+$/, "Bangumi ID 仅支持数字")
    .nullable()
    .optional();

// ── 更新档案 ──

export const UpdateProfileSchema = z
    .object({
        username: z.string().min(1),
        display_name: z.string().min(1),
        bio: z.string().nullable(),
        bio_typewriter_enable: z.boolean(),
        bio_typewriter_speed: z.number().int().min(10).max(500),
        avatar_file: OptionalStringSchema,
        header_file: OptionalStringSchema,
        social_links: SocialLinksSchema,
        home_section_order: z.array(z.string()).nullable(),
        profile_public: z.boolean(),
        show_bangumi_on_profile: z.boolean(),
        bangumi_username: OptionalBangumiIdSchema,
        bangumi_include_private: z.boolean(),
        bangumi_access_token: OptionalStringSchema,
    })
    .partial();

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

// ── 更新隐私设置 ──

export const UpdatePrivacySchema = z
    .object({
        profile_public: z.boolean(),
        show_articles_on_profile: z.boolean(),
        show_diaries_on_profile: z.boolean(),
        show_albums_on_profile: z.boolean(),
        show_comments_on_profile: z.boolean(),
    })
    .partial();

export type UpdatePrivacyInput = z.infer<typeof UpdatePrivacySchema>;
