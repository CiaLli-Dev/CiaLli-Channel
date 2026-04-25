import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import {
    deleteOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { withUserRepositoryContext } from "@/server/repositories/directus/scope";
import {
    parseJsonBody,
    toBooleanValue,
    toOptionalString,
    toStringValue,
} from "@/server/api/utils";
import { cacheManager } from "@/server/cache/manager";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import {
    collectCommentDeletionTargets,
    deleteCollectedCommentTargets,
} from "@/server/api/v1/comments-shared";

import {
    ADMIN_MODULE_COLLECTION,
    DIARY_FIELDS,
} from "@/server/api/v1/shared/constants";
import type { AdminModuleKey } from "@/server/api/v1/shared/types";
import { hasOwn } from "@/server/api/v1/shared/helpers";
import { requireAdmin } from "@/server/api/v1/shared/auth";
import { invalidateArticleInteractionAggregate } from "@/server/api/v1/shared/article-interaction";
import { invalidateDiaryInteractionAggregate } from "@/server/api/v1/shared/diary-interaction";
import { parseBodyTextField, parseRouteId } from "@/server/api/v1/shared/parse";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";
import { searchIndex } from "@/server/application/shared/search-index";

function buildDiaryDetailInvalidationTasks(
    id: string,
    shortId?: string | null,
): Array<Promise<void>> {
    const tasks: Array<Promise<void>> = [
        cacheManager.invalidate("diary-detail", id),
    ];
    const normalizedShortId = String(shortId ?? "").trim();
    if (normalizedShortId) {
        tasks.push(cacheManager.invalidate("diary-detail", normalizedShortId));
    }
    return tasks;
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

type ContentListItem = {
    module: AdminModuleKey;
    id: string;
    author_id?: string;
    title?: string;
    status?: string;
    is_public?: boolean;
    show_on_profile?: boolean;
    date_created?: string | null;
};

async function fetchModuleItems(
    key: AdminModuleKey,
): Promise<ContentListItem[]> {
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
        query.filter = { praviate: { _eq: true } } as JsonObject;
    }
    const rows = await readMany(collection, query);
    return (rows as JsonObject[]).map((row) => {
        const rowBody = toOptionalString(row.body);
        return {
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
                typeof row.is_public === "boolean" ? row.is_public : undefined,
            show_on_profile:
                typeof row.show_on_profile === "boolean"
                    ? row.show_on_profile
                    : undefined,
            date_created: toOptionalString(row.date_created),
        };
    });
}

async function handleContentList(context: APIContext): Promise<Response> {
    const module = context.url.searchParams.get("module")?.trim() as
        | AdminModuleKey
        | undefined;

    const modules: AdminModuleKey[] = module
        ? ([module] as AdminModuleKey[])
        : (Object.keys(ADMIN_MODULE_COLLECTION) as AdminModuleKey[]);

    const results = await Promise.all(modules.map(fetchModuleItems));
    const items = results.flat();

    items.sort((a, b) => {
        const at = new Date(a.date_created || "1970-01-01").getTime();
        const bt = new Date(b.date_created || "1970-01-01").getTime();
        return bt - at;
    });
    return ok({ items });
}

async function invalidatePatchCache(
    module: AdminModuleKey,
    id: string,
    updatedShortId: string | null | undefined,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];

    if (module === "articles") {
        tasks.push(
            cacheManager.invalidateByDomain("article-list"),
            cacheManager.invalidateByDomain("article-taxonomy"),
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidate("article-detail", id),
            cacheManager.invalidateByDomain("mixed-feed"),
        );
    } else if (module === "diaries") {
        tasks.push(
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("mixed-feed"),
            ...buildDiaryDetailInvalidationTasks(id, updatedShortId),
        );
    } else if (module === "albums") {
        tasks.push(
            cacheManager.invalidateByDomain("album-list"),
            cacheManager.invalidate("album-detail", id),
        );
    } else if (module === "article-comments") {
        const articleId = toOptionalString(relatedComment?.article_id);
        if (articleId) {
            tasks.push(
                invalidateArticleInteractionAggregate(articleId),
                cacheManager.invalidate("article-detail", articleId),
            );
        }
        tasks.push(cacheManager.invalidateByDomain("mixed-feed"));
    } else if (module === "diary-comments") {
        const diaryId = toOptionalString(relatedComment?.diary_id);
        if (diaryId) {
            tasks.push(
                invalidateDiaryInteractionAggregate(diaryId),
                ...buildDiaryDetailInvalidationTasks(diaryId),
            );
        }
        tasks.push(cacheManager.invalidateByDomain("mixed-feed"));
    }

    await awaitCacheInvalidations(tasks, {
        label: `admin/content#patch:${module}`,
    });
}

type AdminCollection = (typeof ADMIN_MODULE_COLLECTION)[AdminModuleKey];

async function releaseCollectionOwnerResources(
    collection: AdminCollection,
    id: string,
): Promise<void> {
    await resourceLifecycle.releaseOwnerResources({
        ownerCollection: collection,
        ownerId: id,
    });
}

async function handleContentPatch(
    context: APIContext,
    module: AdminModuleKey,
    id: string,
    collection: AdminCollection,
    adminVisibleDiary: { id: string; short_id: string | null } | null,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<Response> {
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
        payload.show_on_profile = toBooleanValue(body.show_on_profile, true);
    }
    if (hasOwn(body, "allow_comments")) {
        payload.allow_comments = toBooleanValue(body.allow_comments, true);
    }
    const updated = await updateOne(
        collection,
        id,
        payload,
        module === "diaries" ? { fields: [...DIARY_FIELDS] } : undefined,
    );
    const updatedShortId =
        module === "diaries" && "short_id" in updated
            ? toOptionalString(updated.short_id)
            : adminVisibleDiary?.short_id;
    await invalidatePatchCache(module, id, updatedShortId, relatedComment);
    return ok({ item: updated });
}

async function invalidateDeleteCache(
    module: AdminModuleKey,
    id: string,
    deletedDiaryShortId: string | null,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];

    if (module === "articles") {
        tasks.push(
            cacheManager.invalidateByDomain("article-list"),
            cacheManager.invalidateByDomain("article-taxonomy"),
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidate("article-detail", id),
            cacheManager.invalidateByDomain("mixed-feed"),
        );
    } else if (module === "diaries") {
        tasks.push(
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("mixed-feed"),
            ...buildDiaryDetailInvalidationTasks(id, deletedDiaryShortId),
        );
    } else if (module === "albums") {
        tasks.push(
            cacheManager.invalidateByDomain("album-list"),
            cacheManager.invalidate("album-detail", id),
        );
    } else if (module === "article-comments") {
        const articleId = toOptionalString(relatedComment?.article_id);
        if (articleId) {
            tasks.push(
                invalidateArticleInteractionAggregate(articleId),
                cacheManager.invalidate("article-detail", articleId),
            );
        }
        tasks.push(cacheManager.invalidateByDomain("mixed-feed"));
    } else if (module === "diary-comments") {
        const diaryId = toOptionalString(relatedComment?.diary_id);
        if (diaryId) {
            tasks.push(
                invalidateDiaryInteractionAggregate(diaryId),
                ...buildDiaryDetailInvalidationTasks(diaryId),
            );
        }
        tasks.push(cacheManager.invalidateByDomain("mixed-feed"));
    }

    await awaitCacheInvalidations(tasks, {
        label: `admin/content#delete:${module}`,
    });
}

async function handleContentDelete(
    module: AdminModuleKey,
    id: string,
    collection: AdminCollection,
    adminVisibleDiary: { id: string; short_id: string | null } | null,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<Response> {
    if (module === "article-comments") {
        return await handleArticleCommentDelete(id, relatedComment);
    }
    if (module === "diary-comments") {
        return await handleDiaryCommentDelete(id, relatedComment);
    }

    if (module === "articles") {
        return await handleArticleDelete(collection, id, relatedComment);
    }

    if (module === "diaries") {
        return await handleDiaryDelete(
            collection,
            id,
            adminVisibleDiary,
            relatedComment,
        );
    }

    if (module === "albums") {
        return await handleAlbumDelete(collection, id, relatedComment);
    }

    await releaseCollectionOwnerResources(collection, id);
    await deleteOne(collection, id);
    await invalidateDeleteCache(
        module,
        id,
        module === "diaries" ? (adminVisibleDiary?.short_id ?? null) : null,
        relatedComment,
    );
    return ok({ id, module });
}

async function handleArticleCommentDelete(
    id: string,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<Response> {
    const deletedComments = await collectCommentDeletionTargets(
        "app_article_comments",
        id,
    );
    for (const deletedComment of deletedComments) {
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_article_comments",
            ownerId: deletedComment.id,
        });
        await searchIndex.remove("comment", deletedComment.id);
    }
    await deleteCollectedCommentTargets(
        "app_article_comments",
        id,
        deletedComments,
    );
    await invalidateDeleteCache("article-comments", id, null, relatedComment);
    return ok({ id, module: "article-comments" });
}

async function handleDiaryCommentDelete(
    id: string,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<Response> {
    const deletedComments = await collectCommentDeletionTargets(
        "app_diary_comments",
        id,
    );
    for (const deletedComment of deletedComments) {
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_diary_comments",
            ownerId: deletedComment.id,
        });
        await searchIndex.remove("comment", deletedComment.id);
    }
    await deleteCollectedCommentTargets(
        "app_diary_comments",
        id,
        deletedComments,
    );
    await invalidateDeleteCache("diary-comments", id, null, relatedComment);
    return ok({ id, module: "diary-comments" });
}

async function handleArticleDelete(
    collection: AdminCollection,
    id: string,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<Response> {
    const target = await readOneById("app_articles", id, {
        fields: ["id", "body_markdown", "cover_file"],
    });
    if (!target) {
        return fail("内容不存在", 404);
    }
    const commentRows = await readMany("app_article_comments", {
        filter: { article_id: { _eq: id } } as JsonObject,
        fields: ["id"],
        limit: 5000,
    });
    for (const comment of commentRows) {
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_article_comments",
            ownerId: String(comment.id),
        });
        await searchIndex.remove("comment", String(comment.id));
    }
    await resourceLifecycle.releaseOwnerResources({
        ownerCollection: "app_articles",
        ownerId: id,
    });
    await deleteOne(collection, id);
    await searchIndex.remove("article", id);
    await invalidateDeleteCache("articles", id, null, relatedComment);
    return ok({ id, module: "articles" });
}

async function handleDiaryDelete(
    collection: AdminCollection,
    id: string,
    adminVisibleDiary: { id: string; short_id: string | null } | null,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<Response> {
    const target = await readOneById("app_diaries", id, {
        fields: ["id", "content"],
    });
    if (!target) {
        return fail("日记不存在", 404);
    }
    const [commentRows, imageRows] = await Promise.all([
        readMany("app_diary_comments", {
            filter: { diary_id: { _eq: id } } as JsonObject,
            fields: ["id"],
            limit: 5000,
        }),
        readMany("app_diary_images", {
            filter: { diary_id: { _eq: id } } as JsonObject,
            fields: ["id"],
            limit: 5000,
        }),
    ]);
    for (const image of imageRows) {
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_diary_images",
            ownerId: String(image.id),
        });
    }
    for (const comment of commentRows) {
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_diary_comments",
            ownerId: String(comment.id),
        });
        await searchIndex.remove("comment", String(comment.id));
    }
    await resourceLifecycle.releaseOwnerResources({
        ownerCollection: "app_diaries",
        ownerId: id,
    });
    await deleteOne(collection, id);
    await searchIndex.remove("diary", id);
    await invalidateDeleteCache(
        "diaries",
        id,
        adminVisibleDiary?.short_id ?? null,
        relatedComment,
    );
    return ok({ id, module: "diaries" });
}

async function handleAlbumDelete(
    collection: AdminCollection,
    id: string,
    relatedComment: { article_id?: string; diary_id?: string } | undefined,
): Promise<Response> {
    const target = await readOneById("app_albums", id, {
        fields: ["id", "cover_file"],
    });
    if (!target) {
        return fail("内容不存在", 404);
    }
    const photoRows = await readMany("app_album_photos", {
        filter: { album_id: { _eq: id } } as JsonObject,
        fields: ["id"],
        limit: 5000,
    });
    for (const photo of photoRows) {
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_album_photos",
            ownerId: String(photo.id),
        });
    }
    await resourceLifecycle.releaseOwnerResources({
        ownerCollection: "app_albums",
        ownerId: id,
    });
    await deleteOne(collection, id);
    await searchIndex.remove("album", id);
    await invalidateDeleteCache("albums", id, null, relatedComment);
    return ok({ id, module: "albums" });
}

async function loadRelatedComment(
    collection: AdminCollection,
    module: AdminModuleKey,
    id: string,
): Promise<{ article_id?: string; diary_id?: string } | undefined> {
    const rows = await readMany(collection, {
        filter: { id: { _eq: id } } as JsonObject,
        fields:
            module === "article-comments"
                ? ["id", "article_id"]
                : ["id", "diary_id"],
        limit: 1,
    });
    return rows[0] as { article_id?: string; diary_id?: string } | undefined;
}

async function handleContentItem(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const module = parseRouteId(segments[1]) as AdminModuleKey;
    const id = parseRouteId(segments[2]);
    if (!module || !id) {
        return fail("参数不完整", 400);
    }
    if (!(module in ADMIN_MODULE_COLLECTION)) {
        return fail("不支持的模块", 400);
    }
    const collection = ADMIN_MODULE_COLLECTION[module];
    const method = context.request.method;

    const needsPublicDiaryGuard =
        module === "diaries" && (method === "PATCH" || method === "DELETE");
    const needsCommentRelation =
        (module === "article-comments" || module === "diary-comments") &&
        (method === "PATCH" || method === "DELETE");

    const adminVisibleDiary = needsPublicDiaryGuard
        ? await loadAdminVisibleDiary(id)
        : null;

    if (needsPublicDiaryGuard && !adminVisibleDiary) {
        return fail("日记不存在", 404);
    }

    const relatedComment = needsCommentRelation
        ? await loadRelatedComment(collection, module, id)
        : undefined;

    if (method === "PATCH") {
        return handleContentPatch(
            context,
            module,
            id,
            collection,
            adminVisibleDiary,
            relatedComment,
        );
    }

    if (method === "DELETE") {
        return handleContentDelete(
            module,
            id,
            collection,
            adminVisibleDiary,
            relatedComment,
        );
    }

    return fail("未找到接口", 404);
}

async function handleFileRestore(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const id = parseRouteId(segments[2]);
    if (!id) {
        return fail("参数不完整", 400);
    }
    if (context.request.method !== "POST") {
        return fail("未找到接口", 404);
    }

    const result = await resourceLifecycle.restoreQuarantinedFiles({
        fileIds: [id],
        requireReference: true,
    });
    if (result.restoredFileIds.includes(id)) {
        return ok({ file_id: id, restored: true, result });
    }
    if (result.skippedMissingFileIds.includes(id)) {
        return fail("文件不存在", 404);
    }
    if (result.skippedNotQuarantinedFileIds.includes(id)) {
        return fail("文件不处于隔离状态，不能恢复", 409);
    }
    if (result.skippedUnreferencedFileIds.includes(id)) {
        return fail("文件没有有效引用，已阻止误恢复", 409);
    }
    return fail("文件恢复失败", 409);
}

export async function handleAdminContent(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    return await withUserRepositoryContext(required.accessToken, async () => {
        if (segments.length === 1 && context.request.method === "GET") {
            return handleContentList(context);
        }

        if (
            segments.length === 4 &&
            segments[1] === "files" &&
            segments[3] === "restore"
        ) {
            return handleFileRestore(context, segments);
        }

        if (segments.length === 3) {
            return handleContentItem(context, segments);
        }

        return fail("未找到接口", 404);
    });
}
