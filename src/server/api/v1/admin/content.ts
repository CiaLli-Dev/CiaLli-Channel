import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import {
    deleteOne,
    readMany,
    runWithDirectusUserAccess,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import {
    parseJsonBody,
    toBooleanValue,
    toOptionalString,
    toStringValue,
} from "@/server/api/utils";
import { cacheManager } from "@/server/cache/manager";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import {
    cleanupOwnedOrphanDirectusFiles,
    collectAlbumFileIds,
    collectDiaryFileIds,
    extractDirectusAssetIdsFromMarkdown,
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
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidate("article-detail", id),
            cacheManager.invalidateByDomain("home-feed"),
        );
    } else if (module === "diaries") {
        tasks.push(
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("home-feed"),
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
        tasks.push(cacheManager.invalidateByDomain("home-feed"));
    } else if (module === "diary-comments") {
        const diaryId = toOptionalString(relatedComment?.diary_id);
        if (diaryId) {
            tasks.push(...buildDiaryDetailInvalidationTasks(diaryId));
        }
        tasks.push(cacheManager.invalidateByDomain("home-feed"));
    }

    await awaitCacheInvalidations(tasks, {
        label: `admin/content#patch:${module}`,
    });
}

type AdminCollection = (typeof ADMIN_MODULE_COLLECTION)[AdminModuleKey];
type DeleteFileIdResult = {
    fileIds: string[];
    ownerUserId: string | null;
};

async function collectArticleDeleteFileIds(
    id: string,
): Promise<DeleteFileIdResult> {
    const rows = await readMany("app_articles", {
        filter: { id: { _eq: id } } as JsonObject,
        fields: ["cover_file", "body_markdown", "author_id"],
        limit: 1,
    });
    const ownerUserId = toOptionalString(rows[0]?.author_id);
    const fileIds = extractDirectusAssetIdsFromMarkdown(
        toOptionalString(rows[0]?.body_markdown) ?? "",
    );
    const coverFile = normalizeDirectusFileId(rows[0]?.cover_file);
    if (coverFile) {
        fileIds.unshift(coverFile);
    }
    return { fileIds, ownerUserId };
}

async function collectAlbumDeleteFileIds(
    id: string,
): Promise<DeleteFileIdResult> {
    const rows = await readMany("app_albums", {
        filter: { id: { _eq: id } } as JsonObject,
        fields: ["cover_file", "author_id"],
        limit: 1,
    });
    return {
        fileIds: await collectAlbumFileIds(id, rows[0]?.cover_file),
        ownerUserId: toOptionalString(rows[0]?.author_id),
    };
}

async function collectDiaryDeleteFileIds(
    id: string,
): Promise<DeleteFileIdResult> {
    const rows = await readMany("app_diaries", {
        filter: { id: { _eq: id } } as JsonObject,
        fields: ["author_id", "content"],
        limit: 1,
    });
    const fileIds = await collectDiaryFileIds(id);
    fileIds.push(
        ...extractDirectusAssetIdsFromMarkdown(
            toOptionalString(rows[0]?.content) ?? "",
        ),
    );
    return {
        fileIds,
        ownerUserId: toOptionalString(rows[0]?.author_id),
    };
}

async function collectCommentDeleteFileIds(
    collection: "app_article_comments" | "app_diary_comments",
    id: string,
): Promise<DeleteFileIdResult> {
    const rows = await readMany(collection, {
        filter: { id: { _eq: id } } as JsonObject,
        fields: ["author_id", "body"],
        limit: 1,
    });
    return {
        fileIds: extractDirectusAssetIdsFromMarkdown(
            toOptionalString(rows[0]?.body) ?? "",
        ),
        ownerUserId: toOptionalString(rows[0]?.author_id),
    };
}

const DELETE_FILE_ID_COLLECTORS: Record<
    AdminModuleKey,
    (id: string) => Promise<DeleteFileIdResult>
> = {
    articles: collectArticleDeleteFileIds,
    albums: collectAlbumDeleteFileIds,
    diaries: collectDiaryDeleteFileIds,
    "article-comments": (id) =>
        collectCommentDeleteFileIds("app_article_comments", id),
    "diary-comments": (id) =>
        collectCommentDeleteFileIds("app_diary_comments", id),
};

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

async function collectDeleteFileIds(
    module: AdminModuleKey,
    id: string,
    adminVisibleDiary: { id: string; short_id: string | null } | null,
): Promise<{
    fileIds: string[];
    deletedDiaryShortId: string | null;
    ownerUserId: string | null;
}> {
    const { fileIds, ownerUserId } =
        await DELETE_FILE_ID_COLLECTORS[module](id);
    const deletedDiaryShortId =
        module === "diaries" ? (adminVisibleDiary?.short_id ?? null) : null;
    return { fileIds, deletedDiaryShortId, ownerUserId };
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
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidate("article-detail", id),
            cacheManager.invalidateByDomain("home-feed"),
        );
    } else if (module === "diaries") {
        tasks.push(
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("home-feed"),
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
        tasks.push(cacheManager.invalidateByDomain("home-feed"));
    } else if (module === "diary-comments") {
        const diaryId = toOptionalString(relatedComment?.diary_id);
        if (diaryId) {
            tasks.push(...buildDiaryDetailInvalidationTasks(diaryId));
        }
        tasks.push(cacheManager.invalidateByDomain("home-feed"));
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
    const { fileIds, deletedDiaryShortId, ownerUserId } =
        await collectDeleteFileIds(module, id, adminVisibleDiary);
    await deleteOne(collection, id);
    await cleanupOwnedOrphanDirectusFiles({
        candidateFileIds: fileIds,
        ownerUserId: ownerUserId ?? undefined,
    });
    await invalidateDeleteCache(
        module,
        id,
        deletedDiaryShortId,
        relatedComment,
    );
    return ok({ id, module });
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

export async function handleAdminContent(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    return await runWithDirectusUserAccess(required.accessToken, async () => {
        if (segments.length === 1 && context.request.method === "GET") {
            return handleContentList(context);
        }

        if (segments.length === 3) {
            return handleContentItem(context, segments);
        }

        return fail("未找到接口", 404);
    });
}
