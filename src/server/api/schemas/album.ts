/**
 * 相册相关 Zod Schema
 */
import * as z from "zod";

import {
    AlbumLayoutSchema,
    AppStatusSchema,
    OptionalIntSchema,
    OptionalStringSchema,
    TagsDefaultSchema,
    TagsSchema,
} from "./common";

// ── 相册状态（仅 draft / published） ──

// ── 创建相册 ──

export const CreateAlbumSchema = z.object({
    title: z.string().min(1, "相册标题必填"),
    slug: OptionalStringSchema,
    description: OptionalStringSchema,
    cover_file: OptionalStringSchema,
    cover_url: OptionalStringSchema,
    date: OptionalStringSchema,
    location: OptionalStringSchema,
    tags: TagsDefaultSchema,
    category: OptionalStringSchema,
    layout: AlbumLayoutSchema.default("grid"),
    columns: z.number().int().min(1).max(10).default(3),
    is_public: z.boolean().default(false),
});

export type CreateAlbumInput = z.infer<typeof CreateAlbumSchema>;

// ── 更新相册 ──

export const UpdateAlbumSchema = z
    .object({
        title: z.string().min(1),
        slug: OptionalStringSchema,
        description: OptionalStringSchema,
        cover_file: OptionalStringSchema,
        cover_url: OptionalStringSchema,
        date: OptionalStringSchema,
        location: OptionalStringSchema,
        tags: TagsSchema,
        category: OptionalStringSchema,
        layout: AlbumLayoutSchema,
        columns: z.number().int().min(1).max(10),
        is_public: z.boolean(),
    })
    .partial();

export type UpdateAlbumInput = z.infer<typeof UpdateAlbumSchema>;

// ── 创建相册照片 ──

export const CreateAlbumPhotoSchema = z.object({
    file_id: OptionalStringSchema,
    image_url: OptionalStringSchema,
    title: OptionalStringSchema,
    description: OptionalStringSchema,
    tags: TagsDefaultSchema,
    taken_at: OptionalStringSchema,
    location: OptionalStringSchema,
    sort: OptionalIntSchema,
    is_public: z.boolean().default(true),
    show_on_profile: z.boolean().default(true),
});

export type CreateAlbumPhotoInput = z.infer<typeof CreateAlbumPhotoSchema>;

// ── 更新相册照片 ──

export const UpdateAlbumPhotoSchema = z
    .object({
        file_id: OptionalStringSchema,
        image_url: OptionalStringSchema,
        title: OptionalStringSchema,
        description: OptionalStringSchema,
        tags: TagsSchema,
        taken_at: OptionalStringSchema,
        location: OptionalStringSchema,
        sort: OptionalIntSchema,
        is_public: z.boolean(),
        show_on_profile: z.boolean(),
        status: AppStatusSchema,
    })
    .partial();

export type UpdateAlbumPhotoInput = z.infer<typeof UpdateAlbumPhotoSchema>;
