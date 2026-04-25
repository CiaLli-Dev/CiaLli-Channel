import type { AppAlbum, AppArticle, AppDiary, AppFriend } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { conflict } from "@/server/api/errors";
import { cacheManager } from "@/server/cache/manager";
import { readMany } from "@/server/directus/client";
import { isUuid } from "@/server/utils/short-id";

import {
    ARTICLE_FIELDS,
    DIARY_FIELDS,
    FRIEND_FIELDS,
} from "@/server/api/v1/shared/constants";
import { filterPublicStatus } from "@/server/api/v1/shared/auth";

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

export async function loadPublicArticleByIdFromRepository(
    id: string,
): Promise<AppArticle | null> {
    const normalizedId = String(id || "").trim();
    if (!isUuid(normalizedId)) {
        return null;
    }
    return await loadPublicArticleWithCache("id", normalizedId);
}

export async function loadPublicArticleBySlugFromRepository(
    slug: string,
): Promise<AppArticle | null> {
    return await loadPublicArticleWithCache("slug", slug);
}

export async function loadPublicFriendsFromRepository(): Promise<AppFriend[]> {
    return await readMany("app_friends", {
        sort: ["sort", "-date_created"],
        fields: [...FRIEND_FIELDS],
        limit: 500,
    });
}

export async function loadArticleBySlugLooseFromRepository(
    slug: string,
): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: { slug: { _eq: slug } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function loadPublicArticleByShortIdFromRepository(
    shortId: string,
): Promise<AppArticle | null> {
    return await loadPublicArticleWithCache("short_id", shortId);
}

export async function loadArticleByShortIdLooseFromRepository(
    shortId: string,
): Promise<AppArticle | null> {
    const rows = await readMany("app_articles", {
        filter: { short_id: { _eq: shortId } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function loadPublicDiaryByIdFromRepository(
    id: string,
): Promise<AppDiary | null> {
    const normalizedId = String(id || "").trim();
    if (!isUuid(normalizedId)) {
        return null;
    }

    const rows = await readMany("app_diaries", {
        filter: {
            _and: [
                { id: { _eq: normalizedId } },
                { status: { _eq: "published" } },
                { praviate: { _eq: true } },
            ],
        } as JsonObject,
        fields: [...DIARY_FIELDS],
        limit: 1,
    });
    return rows[0] || null;
}

export async function loadPublicDiaryByShortIdFromRepository(
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

export async function loadPublicAlbumByIdFromRepository(
    id: string,
): Promise<AppAlbum | null> {
    const normalizedId = String(id || "").trim();
    if (!isUuid(normalizedId)) {
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

export async function loadPublicAlbumByShortIdFromRepository(
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

export async function ensureUsernameAvailableFromRepository(
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
