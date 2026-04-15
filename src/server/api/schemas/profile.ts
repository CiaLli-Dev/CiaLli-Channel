/**
 * 用户档案相关 Zod Schema
 */
import * as z from "zod";

import type { OptionalString, SocialLinks } from "./common";
import { OptionalStringSchema, SocialLinksSchema } from "./common";

type OptionalBangumiId = string | null | undefined;

export type UpdateProfileInput = {
    username?: string;
    display_name?: string;
    bio?: string | null;
    avatar_file?: OptionalString;
    header_file?: OptionalString;
    social_links?: SocialLinks;
    home_section_order?: string[] | null;
    profile_public?: boolean;
    show_bangumi_on_profile?: boolean;
    bangumi_username?: OptionalBangumiId;
    bangumi_include_private?: boolean;
    bangumi_access_token?: OptionalString;
};

export type UpdatePrivacyInput = {
    profile_public?: boolean;
    show_articles_on_profile?: boolean;
    show_diaries_on_profile?: boolean;
    show_albums_on_profile?: boolean;
    show_comments_on_profile?: boolean;
};

const OptionalBangumiIdSchema: z.ZodType<OptionalBangumiId> = z
    .string()
    .trim()
    .regex(/^[0-9]+$/, "Bangumi ID 仅支持数字")
    .nullable()
    .optional();

// ── 更新档案 ──

export const UpdateProfileSchema: z.ZodType<UpdateProfileInput> = z
    .object({
        username: z.string().min(1),
        display_name: z.string().min(1),
        bio: z.string().nullable(),
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

// ── 更新隐私设置 ──

export const UpdatePrivacySchema: z.ZodType<UpdatePrivacyInput> = z
    .object({
        profile_public: z.boolean(),
        show_articles_on_profile: z.boolean(),
        show_diaries_on_profile: z.boolean(),
        show_albums_on_profile: z.boolean(),
        show_comments_on_profile: z.boolean(),
    })
    .partial();
