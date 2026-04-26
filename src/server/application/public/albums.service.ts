import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import { countItems, readMany } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import {
    normalizeAlbumCoverUrl,
    normalizeAlbumPhotoImageUrl,
} from "@/server/application/albums/external-image-fields";
import { parsePagination } from "@/server/api/utils";
import { filterPublicStatus } from "@/server/api/v1/shared/auth";
import { safeCsv } from "@/server/api/v1/shared/helpers";
import { loadPublicAlbumById } from "@/server/api/v1/shared/loaders";
import { parseRouteId } from "@/server/api/v1/shared/parse";
import {
    getAuthorBundle,
    readAuthor,
} from "@/server/api/v1/shared/author-cache";
import { loadProfileByUsernameFromRepository } from "@/server/repositories/profile/profile.repository";

function normalizeAuthorHandle(value: string): string {
    return value.trim().replace(/^@+/, "").toLowerCase();
}

export async function handlePublicAlbumsRoute(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    if (segments.length === 2) {
        const { page, limit, offset } = parsePagination(context.url);
        const authorHandle = normalizeAuthorHandle(
            (context.url.searchParams.get("author") || "").slice(0, 100),
        );

        const cacheKey = hashParams({ page, limit, author: authorHandle });
        const cached = await cacheManager.get<unknown>("album-list", cacheKey);
        if (cached) return ok(cached);

        const andFilters: JsonObject[] = [filterPublicStatus()];
        if (authorHandle) {
            const profile =
                await loadProfileByUsernameFromRepository(authorHandle);
            if (!profile?.user_id) {
                return ok({
                    items: [],
                    page,
                    limit,
                    total: 0,
                });
            }
            andFilters.push({ author_id: { _eq: profile.user_id } });
        }
        const filter = { _and: andFilters } as JsonObject;
        const [rows, total] = await Promise.all([
            readMany("app_albums", {
                filter,
                sort: ["-date", "-date_created"],
                limit,
                offset,
            }),
            countItems("app_albums", filter),
        ]);

        const authorIds = Array.from(
            new Set(rows.map((row) => row.author_id).filter(Boolean)),
        );
        const authorMap = await getAuthorBundle(authorIds);

        const items = rows.map((row) => ({
            ...normalizeAlbumCoverUrl(row),
            tags: safeCsv(row.tags),
            author: readAuthor(authorMap, row.author_id),
        }));

        const result = { items, page, limit, total };
        void cacheManager.set("album-list", cacheKey, result);
        return ok(result);
    }

    if (segments.length === 3) {
        const albumId = parseRouteId(segments[2]);
        if (!albumId) {
            return fail("缺少相册 ID", 400);
        }

        const cached = await cacheManager.get<unknown>("album-detail", albumId);
        if (cached) return ok(cached);

        const album = await loadPublicAlbumById(albumId);
        if (!album) {
            return fail("相册不存在", 404);
        }

        const [photos, authorMap] = await Promise.all([
            readMany("app_album_photos", {
                filter: {
                    _and: [
                        { album_id: { _eq: album.id } },
                        { status: { _eq: "published" } },
                        { is_public: { _eq: true } },
                    ],
                } as JsonObject,
                sort: ["sort", "-date_created"],
                limit: 200,
            }),
            getAuthorBundle([album.author_id]),
        ]);

        const result = {
            item: {
                ...normalizeAlbumCoverUrl(album),
                tags: safeCsv(album.tags),
                author: readAuthor(authorMap, album.author_id),
                photos: photos.map((photo) => ({
                    ...normalizeAlbumPhotoImageUrl(photo),
                    tags: safeCsv(photo.tags),
                })),
            },
        };
        void cacheManager.set("album-detail", albumId, result);
        return ok(result);
    }

    return fail("未找到接口", 404);
}
