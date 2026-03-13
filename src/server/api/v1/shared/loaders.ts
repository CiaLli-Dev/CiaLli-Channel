import type { AppAlbum, AppArticle, AppDiary, AppFriend } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { conflict } from "@/server/api/errors";
import { cacheManager } from "@/server/cache/manager";
import { readMany } from "@/server/directus/client";

import { ARTICLE_FIELDS, DIARY_FIELDS, FRIEND_FIELDS } from "./constants";
import { filterPublicStatus } from "./auth";

function buildArticlePublicCacheKey(
    routeType: "id" | "slug" | "short_id",
    routeValue: string,
): string {
    return `v1:${routeType}:${routeValue}`;
}

async function loadPublicArticleWithCache(
    routeType: "id" | "slug" | "short_id",
    routeValue: string,
): Promise<AppArticle | null> {
    const normalizedValue = String(routeValue || "").trim();
    if (!normalizedValue) {
        return null;
    }

    const cacheKey = buildArticlePublicCacheKey(routeType, normalizedValue);
    const cached = await cacheManager.get<{
        exists: boolean;
        article: AppArticle | null;
    }>("article-public", cacheKey);
    if (cached) {
        return cached.article;
    }

    const rows = await readMany("app_articles", {
        filter: {
            _and: [
                { [routeType]: { _eq: normalizedValue } },
                filterPublicStatus(),
            ],
        } as JsonObject,
        fields: [...ARTICLE_FIELDS],
        limit: 1,
    });
    const article = rows[0] || null;
    void cacheManager.set("article-public", cacheKey, {
        exists: true,
        article,
    });
    return article;
}

export async function loadPublicArticleById(
    id: string,
): Promise<AppArticle | null> {
    const normalizedId = String(id || "").trim();
    const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            normalizedId,
        );
    if (!isUuid) {
        return null;
    }
    return await loadPublicArticleWithCache("id", normalizedId);
}

export async function loadPublicArticleBySlug(
    slug: string,
): Promise<AppArticle | null> {
    return await loadPublicArticleWithCache("slug", slug);
}

export async function loadPublicFriends(): Promise<AppFriend[]> {
    return await readMany("app_friends", {
        sort: ["sort", "-date_created"],
        fields: [...FRIEND_FIELDS],
        limit: 500,
    });
}

/** 宽松版本：不检查 status/is_public（用于 owner 回退） */
export async function loadArticleBySlugLoose(
    slug: string,
): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: { slug: { _eq: slug } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function loadPublicArticleByShortId(
    shortId: string,
): Promise<AppArticle | null> {
    return await loadPublicArticleWithCache("short_id", shortId);
}

/** 宽松版本：不检查 status/is_public（用于 owner 回退） */
export async function loadArticleByShortIdLoose(
    shortId: string,
): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: { short_id: { _eq: shortId } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function loadPublicDiaryById(
    id: string,
): Promise<AppDiary | null> {
    const rows = await readMany("app_diaries", {
        filter: {
            _and: [
                { id: { _eq: id } },
                { status: { _eq: "published" } },
                { praviate: { _eq: true } },
            ],
        } as JsonObject,
        fields: [...DIARY_FIELDS],
        limit: 1,
    });
    return rows[0] || null;
}

export async function loadPublicDiaryByShortId(
    shortId: string,
): Promise<AppDiary | null> {
    const rows = await readMany("app_diaries", {
        filter: {
            _and: [
                { short_id: { _eq: shortId } },
                { status: { _eq: "published" } },
                { praviate: { _eq: true } },
            ],
        } as JsonObject,
        fields: [...DIARY_FIELDS],
        limit: 1,
    });
    return rows[0] || null;
}

export async function loadPublicAlbumById(
    id: string,
): Promise<AppAlbum | null> {
    const normalizedId = String(id || "").trim();
    const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            normalizedId,
        );
    if (!isUuid) {
        return null;
    }

    const rows = await readMany("app_albums", {
        filter: {
            _and: [{ id: { _eq: normalizedId } }, filterPublicStatus()],
        } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function loadPublicAlbumByShortId(
    shortId: string,
): Promise<AppAlbum | null> {
    const rows = await readMany("app_albums", {
        filter: {
            _and: [{ short_id: { _eq: shortId } }, filterPublicStatus()],
        } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function ensureUsernameAvailable(
    username: string,
    excludeProfileId?: string,
): Promise<void> {
    const filters: JsonObject[] = [{ username: { _eq: username } }];
    if (excludeProfileId) {
        filters.push({ id: { _neq: excludeProfileId } });
    }
    const rows = await readMany("app_user_profiles", {
        filter: { _and: filters } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    if (rows.length > 0) {
        throw conflict("USERNAME_EXISTS", "用户名已存在");
    }
}
