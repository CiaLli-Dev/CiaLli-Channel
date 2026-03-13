/**
 * User 领域特有类型
 */

import type { AppProfile } from "@/types/app";

/** 用户主页模块标识 */
export type ProfileModule =
    | "articles"
    | "diaries"
    | "bangumi"
    | "albums"
    | "comments";

/** 模块可见性字段映射 */
export const MODULE_VISIBILITY_FIELDS: Record<ProfileModule, keyof AppProfile> =
    {
        articles: "show_articles_on_profile",
        diaries: "show_diaries_on_profile",
        bangumi: "show_bangumi_on_profile",
        albums: "show_albums_on_profile",
        comments: "show_comments_on_profile",
    } as const;
