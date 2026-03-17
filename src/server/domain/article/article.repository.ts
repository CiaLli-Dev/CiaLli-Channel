/**
 * Article Repository — Directus 数据访问封装
 *
 * 将散落在 shared/loaders.ts、me/articles.ts 中的查询模式集中到此处。
 * 写操作自动触发缓存失效。
 */

import type { AppArticle, AppArticleLike } from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    countItems,
    createOne,
    deleteOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { cacheManager } from "@/server/cache/manager";
import { createWithShortId } from "@/server/utils/short-id";
import { filterPublicStatus } from "@/server/api/v1/shared/auth";

// ── 查询 ──

export async function findById(id: string): Promise<AppArticle | null> {
    return await readOneById("app_articles", id);
}

export async function findPublicById(id: string): Promise<AppArticle | null> {
    const normalizedId = String(id || "").trim();
    const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            normalizedId,
        );
    if (!isUuid) return null;

    const rows = await readMany("app_articles", {
        filter: {
            _and: [{ id: { _eq: normalizedId } }, filterPublicStatus()],
        } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function findPublicBySlug(
    slug: string,
): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: {
            _and: [{ slug: { _eq: slug } }, filterPublicStatus()],
        } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function findBySlugLoose(
    slug: string,
): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: { slug: { _eq: slug } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function findPublicByShortId(
    shortId: string,
): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: {
            _and: [{ short_id: { _eq: shortId } }, filterPublicStatus()],
        } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function findByShortIdLoose(
    shortId: string,
): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: { short_id: { _eq: shortId } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export interface ListOptions {
    filter?: JsonObject;
    sort?: string[];
    limit?: number;
    offset?: number;
    fields?: string[];
}

export async function listByAuthor(
    authorId: string,
    options: ListOptions = {},
): Promise<AppArticle[]> {
    return await readMany("app_articles", {
        filter: {
            author_id: { _eq: authorId },
            ...options.filter,
        } as JsonObject,
        sort: options.sort ?? ["-date_created"],
        limit: options.limit,
        offset: options.offset,
        fields: options.fields,
    });
}

export async function listPublic(
    options: ListOptions = {},
): Promise<AppArticle[]> {
    const andFilters: JsonObject[] = [filterPublicStatus()];
    if (options.filter) {
        andFilters.push(options.filter);
    }
    return await readMany("app_articles", {
        filter: { _and: andFilters } as JsonObject,
        sort: options.sort ?? ["-published_at", "-date_created"],
        limit: options.limit,
        offset: options.offset,
        fields: options.fields,
    });
}

export async function countByFilter(filter: JsonObject): Promise<number> {
    return await countItems("app_articles", filter);
}

// ── 写操作（含缓存失效） ──

export async function create(
    payload: Partial<AppArticle>,
): Promise<AppArticle> {
    const created = await createWithShortId("app_articles", payload, createOne);
    void cacheManager.invalidateByDomain("article-list");
    void cacheManager.invalidateByDomain("article-public");
    return created;
}

export async function update(
    id: string,
    payload: JsonObject,
): Promise<AppArticle> {
    const updated = await updateOne("app_articles", id, payload);
    void cacheManager.invalidateByDomain("article-list");
    void cacheManager.invalidateByDomain("article-public");
    void cacheManager.invalidate("article-detail", id);
    return updated;
}

export async function remove(id: string): Promise<void> {
    await deleteOne("app_articles", id);
    void cacheManager.invalidateByDomain("article-list");
    void cacheManager.invalidateByDomain("article-public");
    void cacheManager.invalidate("article-detail", id);
}

// ── 点赞 ──

export async function countPublicLikes(articleId: string): Promise<number> {
    return await countItems("app_article_likes", {
        _and: [
            { article_id: { _eq: articleId } },
            { status: { _eq: "published" } },
        ],
    } as JsonObject);
}

export async function findExistingLike(
    articleId: string,
    userId: string,
): Promise<AppArticleLike | null> {
    const rows = await readMany("app_article_likes", {
        filter: {
            _and: [
                { article_id: { _eq: articleId } },
                { user_id: { _eq: userId } },
            ],
        } as JsonObject,
        sort: ["-date_created"],
        limit: 1,
    });
    return rows[0] || null;
}
