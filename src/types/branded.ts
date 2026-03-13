/**
 * 品牌类型（Branded Types）
 *
 * 通过 TypeScript 结构类型系统的标记技巧，让不同领域的 string ID
 * 在类型层面互不兼容，防止将 ArticleId 误传为 DiaryId 等错误。
 *
 * 运行时零开销：品牌标记仅存在于类型层面，编译后完全消除。
 *
 * 使用方式：
 *   - Domain 层 Repository / Service 参数使用品牌类型
 *   - Zod schema 中通过 `.transform(asArticleId)` 产出品牌类型
 *   - 不改动 src/types/app.ts 中的实体类型（前端也在使用）
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

// ── 实体 ID ──

export type ArticleId = Brand<string, "ArticleId">;
export type DiaryId = Brand<string, "DiaryId">;
export type AlbumId = Brand<string, "AlbumId">;
export type AnimeEntryId = Brand<string, "AnimeEntryId">;
export type CommentId = Brand<string, "CommentId">;
export type UserId = Brand<string, "UserId">;
export type ProfileId = Brand<string, "ProfileId">;
export type FileId = Brand<string, "FileId">;

// ── 值对象 ──

export type ShortId = Brand<string, "ShortId">;
export type Slug = Brand<string, "Slug">;

// ── 构造函数（运行时零开销的类型转换） ──

export function asArticleId(id: string): ArticleId {
    return id as ArticleId;
}
export function asDiaryId(id: string): DiaryId {
    return id as DiaryId;
}
export function asAlbumId(id: string): AlbumId {
    return id as AlbumId;
}
export function asAnimeEntryId(id: string): AnimeEntryId {
    return id as AnimeEntryId;
}
export function asCommentId(id: string): CommentId {
    return id as CommentId;
}
export function asUserId(id: string): UserId {
    return id as UserId;
}
export function asProfileId(id: string): ProfileId {
    return id as ProfileId;
}
export function asFileId(id: string): FileId {
    return id as FileId;
}
export function asShortId(id: string): ShortId {
    return id as ShortId;
}
export function asSlug(slug: string): Slug {
    return slug as Slug;
}
