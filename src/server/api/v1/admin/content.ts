import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import { deleteOne, readMany, updateOne } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import {
    parseJsonBody,
    toBooleanValue,
    toOptionalString,
    toStringValue,
} from "@/server/api/utils";
import { cacheManager } from "@/server/cache/manager";
import {
    cleanupOrphanDirectusFiles,
    collectAlbumFileIds,
    collectDiaryFileIds,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";

import {
    ADMIN_MODULE_COLLECTION,
    DIARY_FIELDS,
    type AdminModuleKey,
    hasOwn,
    invalidateArticleInteractionAggregate,
    parseBodyTextField,
    parseRouteId,
    requireAdmin,
} from "../shared";

function invalidateDiaryDetailCache(id: string, shortId?: string | null): void {
    void cacheManager.invalidate("diary-detail", id);
    const normalizedShortId = String(shortId ?? "").trim();
    if (normalizedShortId) {
        void cacheManager.invalidate("diary-detail", normalizedShortId);
    }
}

async function loadAdminVisibleDiary(
    diaryId: string,
): Promise<{ id: string; short_id: string | null } | null> {
    const rows = await readMany("app_diaries", {
        filter: {
            _and: [{ id: { _eq: diaryId } }, { praviate: { _eq: true } }],
        } as JsonObject,
        fields: ["id", "short_id"],
        limit: 1,
    });
    const first = rows[0] as JsonObject | undefined;
    if (!first) {
        return null;
    }
    return {
        id: toStringValue(first.id),
        short_id: toOptionalString(first.short_id),
    };
}

export async function handleAdminContent(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    if (segments.length === 1 && context.request.method === "GET") {
        const module = context.url.searchParams.get("module")?.trim() as
            | AdminModuleKey
            | undefined;

        const modules: AdminModuleKey[] = module
            ? ([module] as AdminModuleKey[])
            : (Object.keys(ADMIN_MODULE_COLLECTION) as AdminModuleKey[]);

        const items: Array<{
            module: AdminModuleKey;
            id: string;
            author_id?: string;
            title?: string;
            status?: string;
            is_public?: boolean;
            show_on_profile?: boolean;
            date_created?: string | null;
        }> = [];

        for (const key of modules) {
            const collection = ADMIN_MODULE_COLLECTION[key];
            const query: {
                sort: string[];
                limit: number;
                fields?: string[];
                filter?: JsonObject;
            } = {
                sort: ["-date_created"],
                limit: 40,
            };
            if (key === "diaries") {
                query.fields = [...DIARY_FIELDS];
                // 管理端只允许访问公开日记，避免私密内容被批量读取。
                query.filter = { praviate: { _eq: true } } as JsonObject;
            }
            const rows = await readMany(collection, query);
            for (const row of rows as JsonObject[]) {
                const rowBody = toOptionalString(row.body);
                items.push({
                    module: key,
                    id: toStringValue(row.id),
                    author_id: toOptionalString(row.author_id) || undefined,
                    title:
                        toOptionalString(row.title) ||
                        toOptionalString(row.slug) ||
                        rowBody ||
                        toOptionalString(row.content) ||
                        undefined,
                    status: toOptionalString(row.status) || undefined,
                    is_public:
                        typeof row.is_public === "boolean"
                            ? row.is_public
                            : undefined,
                    show_on_profile:
                        typeof row.show_on_profile === "boolean"
                            ? row.show_on_profile
                            : undefined,
                    date_created: toOptionalString(row.date_created),
                });
            }
        }

        items.sort((a, b) => {
            const at = new Date(a.date_created || "1970-01-01").getTime();
            const bt = new Date(b.date_created || "1970-01-01").getTime();
            return bt - at;
        });
        return ok({ items });
    }

    if (segments.length === 3) {
        const module = parseRouteId(segments[1]) as AdminModuleKey;
        const id = parseRouteId(segments[2]);
        if (!module || !id) {
            return fail("参数不完整", 400);
        }
        if (!(module in ADMIN_MODULE_COLLECTION)) {
            return fail("不支持的模块", 400);
        }
        const collection = ADMIN_MODULE_COLLECTION[module];
        const needsPublicDiaryGuard =
            module === "diaries" &&
            (context.request.method === "PATCH" ||
                context.request.method === "DELETE");
        const needsCommentRelation =
            (module === "article-comments" || module === "diary-comments") &&
            (context.request.method === "PATCH" ||
                context.request.method === "DELETE");
        const adminVisibleDiary = needsPublicDiaryGuard
            ? await loadAdminVisibleDiary(id)
            : null;
        const relatedCommentRows = needsCommentRelation
            ? await readMany(collection, {
                  filter: { id: { _eq: id } } as JsonObject,
                  fields:
                      module === "article-comments"
                          ? ["id", "article_id"]
                          : ["id", "diary_id"],
                  limit: 1,
              })
            : [];
        const relatedComment = relatedCommentRows[0] as
            | { article_id?: string; diary_id?: string }
            | undefined;
        if (needsPublicDiaryGuard && !adminVisibleDiary) {
            return fail("日记不存在", 404);
        }

        if (context.request.method === "PATCH") {
            const body = await parseJsonBody(context.request);
            const payload: JsonObject = {};
            if (hasOwn(body, "status")) {
                payload.status = parseBodyTextField(body, "status");
            }
            if (hasOwn(body, "is_public")) {
                payload.is_public = toBooleanValue(body.is_public, true);
            }
            if (
                module !== "albums" &&
                module !== "articles" &&
                hasOwn(body, "show_on_profile")
            ) {
                payload.show_on_profile = toBooleanValue(
                    body.show_on_profile,
                    true,
                );
            }
            if (hasOwn(body, "allow_comments")) {
                payload.allow_comments = toBooleanValue(
                    body.allow_comments,
                    true,
                );
            }
            const updated = await updateOne(
                collection,
                id,
                payload,
                module === "diaries"
                    ? {
                          fields: [...DIARY_FIELDS],
                      }
                    : undefined,
            );
            // 失效缓存
            if (module === "articles") {
                void cacheManager.invalidateByDomain("article-list");
                void cacheManager.invalidateByDomain("article-public");
                void cacheManager.invalidate("article-detail", id);
                void cacheManager.invalidateByDomain("home-feed");
            } else if (module === "diaries") {
                void cacheManager.invalidateByDomain("diary-list");
                void cacheManager.invalidateByDomain("home-feed");
                const updatedShortId =
                    "short_id" in updated ? updated.short_id : null;
                invalidateDiaryDetailCache(
                    id,
                    toOptionalString(updatedShortId),
                );
            } else if (module === "albums") {
                void cacheManager.invalidateByDomain("album-list");
                void cacheManager.invalidate("album-detail", id);
            } else if (module === "article-comments") {
                const articleId = toOptionalString(relatedComment?.article_id);
                if (articleId) {
                    invalidateArticleInteractionAggregate(articleId);
                    void cacheManager.invalidate("article-detail", articleId);
                }
                void cacheManager.invalidateByDomain("home-feed");
            } else if (module === "diary-comments") {
                const diaryId = toOptionalString(relatedComment?.diary_id);
                if (diaryId) {
                    void invalidateDiaryDetailCache(diaryId);
                }
                void cacheManager.invalidateByDomain("home-feed");
            }
            return ok({ item: updated });
        }

        if (context.request.method === "DELETE") {
            const candidateFileIds: string[] = [];
            if (module === "articles") {
                const rows = await readMany("app_articles", {
                    filter: { id: { _eq: id } } as JsonObject,
                    fields: ["cover_file"],
                    limit: 1,
                });
                const coverFile = normalizeDirectusFileId(rows[0]?.cover_file);
                if (coverFile) {
                    candidateFileIds.push(coverFile);
                }
            }
            if (module === "albums") {
                const rows = await readMany("app_albums", {
                    filter: { id: { _eq: id } } as JsonObject,
                    fields: ["cover_file"],
                    limit: 1,
                });
                const fileIds = await collectAlbumFileIds(
                    id,
                    rows[0]?.cover_file,
                );
                candidateFileIds.push(...fileIds);
            }
            if (module === "diaries") {
                const fileIds = await collectDiaryFileIds(id);
                candidateFileIds.push(...fileIds);
            }
            let deletedDiaryShortId: string | null = null;
            if (module === "diaries") {
                deletedDiaryShortId = adminVisibleDiary?.short_id ?? null;
            }
            await deleteOne(collection, id);
            await cleanupOrphanDirectusFiles(candidateFileIds);
            // 失效缓存
            if (module === "articles") {
                void cacheManager.invalidateByDomain("article-list");
                void cacheManager.invalidateByDomain("article-public");
                void cacheManager.invalidate("article-detail", id);
                void cacheManager.invalidateByDomain("home-feed");
            } else if (module === "diaries") {
                void cacheManager.invalidateByDomain("diary-list");
                void cacheManager.invalidateByDomain("home-feed");
                invalidateDiaryDetailCache(id, deletedDiaryShortId);
            } else if (module === "albums") {
                void cacheManager.invalidateByDomain("album-list");
                void cacheManager.invalidate("album-detail", id);
            } else if (module === "article-comments") {
                const articleId = toOptionalString(relatedComment?.article_id);
                if (articleId) {
                    invalidateArticleInteractionAggregate(articleId);
                    void cacheManager.invalidate("article-detail", articleId);
                }
                void cacheManager.invalidateByDomain("home-feed");
            } else if (module === "diary-comments") {
                const diaryId = toOptionalString(relatedComment?.diary_id);
                if (diaryId) {
                    void invalidateDiaryDetailCache(diaryId);
                }
                void cacheManager.invalidateByDomain("home-feed");
            }
            return ok({ id, module });
        }
    }

    return fail("未找到接口", 404);
}
