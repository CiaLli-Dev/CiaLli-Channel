import type { APIContext } from "astro";

import type { AppDiaryImage } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import { countItems, readMany } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parsePagination } from "@/server/api/utils";
import {
    DEFAULT_LIST_LIMIT,
    DIARY_FIELDS,
    loadPublicDiaryById,
    loadPublicDiaryByShortId,
    parseRouteId,
} from "@/server/api/v1/shared";
import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import { readAuthor } from "@/server/api/v1/public/_helpers";

async function handleDiaryList(context: APIContext): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url);

    const cacheKey = hashParams({ page, limit });
    const cached = await cacheManager.get<unknown>("diary-list", cacheKey);
    if (cached) return ok(cached);

    const filter: JsonObject = {
        _and: [{ status: { _eq: "published" } }, { praviate: { _eq: true } }],
    };
    const [rows, total] = await Promise.all([
        readMany("app_diaries", {
            filter,
            fields: [...DIARY_FIELDS],
            sort: ["-date_created"],
            limit,
            offset,
        }),
        countItems("app_diaries", filter),
    ]);

    const diaryIds = rows.map((row) => row.id);
    const authorIds = Array.from(
        new Set(rows.map((row) => row.author_id).filter(Boolean)),
    );
    const [images, authorMap] = await Promise.all([
        readMany("app_diary_images", {
            filter:
                diaryIds.length > 0
                    ? ({
                          _and: [
                              { diary_id: { _in: diaryIds } },
                              { status: { _eq: "published" } },
                              { is_public: { _eq: true } },
                          ],
                      } as JsonObject)
                    : ({ id: { _null: true } } as JsonObject),
            sort: ["sort", "-date_created"],
            limit: Math.max(diaryIds.length * 6, DEFAULT_LIST_LIMIT),
        }),
        getAuthorBundle(authorIds),
    ]);

    const imageMap = new Map<string, AppDiaryImage[]>();
    for (const image of images) {
        const list = imageMap.get(image.diary_id) || [];
        list.push(image);
        imageMap.set(image.diary_id, list);
    }

    const items = rows.map((row) => ({
        ...row,
        author: readAuthor(authorMap, row.author_id),
        images: imageMap.get(row.id) || [],
    }));

    const result = { items, page, limit, total };
    void cacheManager.set("diary-list", cacheKey, result);
    return ok(result);
}

async function handleDiaryDetail(segments: string[]): Promise<Response> {
    const id = parseRouteId(segments[2]);
    if (!id) {
        return fail("缺少日记 ID", 400);
    }

    const cached = await cacheManager.get<unknown>("diary-detail", id);
    if (cached) return ok(cached);

    const diary =
        (await loadPublicDiaryById(id)) || (await loadPublicDiaryByShortId(id));
    if (!diary) {
        return fail("日记不存在", 404);
    }
    const [images, authorMap] = await Promise.all([
        readMany("app_diary_images", {
            filter: {
                _and: [
                    { diary_id: { _eq: diary.id } },
                    { status: { _eq: "published" } },
                    { is_public: { _eq: true } },
                ],
            } as JsonObject,
            sort: ["sort", "-date_created"],
            limit: 100,
        }),
        getAuthorBundle([diary.author_id]),
    ]);

    const result = {
        item: {
            ...diary,
            author: readAuthor(authorMap, diary.author_id),
            images,
        },
    };
    void cacheManager.set("diary-detail", id, result);
    const normalizedShortId = String(diary.short_id ?? "").trim();
    if (normalizedShortId && normalizedShortId !== id) {
        void cacheManager.set("diary-detail", normalizedShortId, result);
    }
    if (diary.id && diary.id !== id) {
        void cacheManager.set("diary-detail", diary.id, result);
    }
    return ok(result);
}

export async function handlePublicDiariesRoute(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    if (segments.length === 2) {
        return await handleDiaryList(context);
    }

    if (segments.length === 3) {
        return await handleDiaryDetail(segments);
    }

    return fail("未找到接口", 404);
}
