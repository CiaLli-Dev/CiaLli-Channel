import type { APIContext } from "astro";

import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import {
    readOneById,
    runWithDirectusPublicAccess,
    runWithDirectusUserAccess,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { UpdateCommentSchema, CreateCommentSchema } from "@/server/api/schemas";

import { DIARY_FIELDS, parseRouteId, requireAccess } from "./shared";
import {
    buildCommentUpdatePayload,
    buildDecoratedCommentTree,
    createDiaryComment,
    deleteCommentWithDescendants,
    handleCommentPreview,
    loadPaginatedComments,
    parseCommentPagination,
    renderCommentItem,
    validateReplyParent,
} from "./comments-shared";
import {
    cleanupOwnedOrphanDirectusFiles,
    extractDirectusAssetIdsFromMarkdown,
} from "./shared/file-cleanup";
import { syncMarkdownFilesToVisibility } from "./me/_helpers";

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

async function invalidateDiaryDetailCacheByDiaryId(
    diaryId: string,
): Promise<void> {
    const diary = await readOneById("app_diaries", diaryId, {
        fields: ["id", "short_id"],
    });
    if (!diary) {
        await awaitCacheInvalidations(
            [...buildDiaryDetailInvalidationTasks(diaryId)],
            { label: "comments-diary#invalidate-detail" },
        );
        return;
    }
    await awaitCacheInvalidations(
        [
            ...buildDiaryDetailInvalidationTasks(
                String(diary.id),
                diary.short_id,
            ),
        ],
        { label: "comments-diary#invalidate-detail" },
    );
}

async function handleDiaryCommentGet(
    context: APIContext,
    diaryId: string,
): Promise<Response> {
    const diary = await readOneById("app_diaries", diaryId, {
        fields: [...DIARY_FIELDS],
    });
    if (!diary) {
        return fail("日记不存在", 404);
    }
    if (!(diary.status === "published" && diary.praviate === true)) {
        return fail("日记不可见", 404);
    }

    const pagination = parseCommentPagination(context.url);
    const pagedComments = await loadPaginatedComments(
        "app_diary_comments",
        "diary_id",
        diaryId,
        pagination,
    );

    const tree = await buildDecoratedCommentTree(
        context,
        pagedComments.comments,
        "app_diary_comment_likes",
        "diary",
    );
    return ok({
        items: tree,
        total: pagedComments.totalTopLevel,
        total_top_level: pagedComments.totalTopLevel,
        page: pagedComments.page,
        limit: pagedComments.limit,
        has_more: pagedComments.hasMore,
    });
}

async function handleDiaryCommentPost(
    context: APIContext,
    diaryId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    assertCan(access, "can_comment_diaries");

    const diary = await readOneById("app_diaries", diaryId, {
        fields: [...DIARY_FIELDS],
    });
    if (!diary) {
        return fail("日记不存在", 404);
    }
    if (!diary.allow_comments) {
        return fail("该日记已关闭评论", 403);
    }

    const body = await parseJsonBody(context.request);
    const input = validateBody(CreateCommentSchema, body);
    if (input.parent_id) {
        const parentValidationError = await validateReplyParent(
            "app_diary_comments",
            input.parent_id,
            diaryId,
            "diary_id",
        );
        if (parentValidationError) {
            return parentValidationError;
        }
    }

    const created = (await createDiaryComment(
        diaryId,
        access.user.id,
        input,
    )) as {
        body: string;
        is_public: boolean;
    } & Awaited<ReturnType<typeof createDiaryComment>>;
    await syncMarkdownFilesToVisibility(
        created.body,
        access.user.id,
        created.is_public ? "public" : "private",
    );
    await awaitCacheInvalidations(
        [
            ...buildDiaryDetailInvalidationTasks(
                String(diary.id),
                diary.short_id,
            ),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "comments-diary#create" },
    );
    return ok({
        item: await renderCommentItem(created),
    });
}

async function handleDiaryCommentListOrCreate(
    context: APIContext,
    diaryId: string,
): Promise<Response> {
    if (context.request.method === "GET") {
        return handleDiaryCommentGet(context, diaryId);
    }
    if (context.request.method === "POST") {
        return handleDiaryCommentPost(context, diaryId);
    }
    return fail("方法不允许", 405);
}

async function handleDiaryCommentPatch(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    const comment = await readOneById("app_diary_comments", commentId);
    if (!comment) {
        return fail("评论不存在", 404);
    }
    assertOwnerOrAdmin(access, comment.author_id);

    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateCommentSchema, body);
    const prevBodyFileIds = extractDirectusAssetIdsFromMarkdown(
        String(comment.body ?? ""),
    );
    const payload = buildCommentUpdatePayload(input);
    const updated = await updateOne("app_diary_comments", commentId, payload);
    if (input.body !== undefined || input.is_public !== undefined) {
        await syncMarkdownFilesToVisibility(
            input.body ?? updated.body,
            comment.author_id,
            (input.is_public ?? updated.is_public) ? "public" : "private",
        );
    }
    if (input.body !== undefined && prevBodyFileIds.length > 0) {
        const nextBodyFileIds = new Set(
            extractDirectusAssetIdsFromMarkdown(input.body),
        );
        const removedBodyFileIds = prevBodyFileIds.filter(
            (id) => !nextBodyFileIds.has(id),
        );
        if (removedBodyFileIds.length > 0) {
            await cleanupOwnedOrphanDirectusFiles({
                candidateFileIds: removedBodyFileIds,
                ownerUserIds: [comment.author_id],
            });
        }
    }
    await awaitCacheInvalidations(
        [
            invalidateDiaryDetailCacheByDiaryId(comment.diary_id),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "comments-diary#patch" },
    );
    return ok({
        item: await renderCommentItem(updated),
    });
}

async function handleDiaryCommentDelete(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    const comment = await readOneById("app_diary_comments", commentId);
    if (!comment) {
        return fail("评论不存在", 404);
    }
    assertOwnerOrAdmin(access, comment.author_id);

    await deleteCommentWithDescendants("app_diary_comments", commentId);
    await awaitCacheInvalidations(
        [
            invalidateDiaryDetailCacheByDiaryId(comment.diary_id),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "comments-diary#delete" },
    );
    return ok({ id: commentId });
}

async function handleDiaryCommentById(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    if (context.request.method === "PATCH") {
        return handleDiaryCommentPatch(context, commentId);
    }
    if (context.request.method === "DELETE") {
        return handleDiaryCommentDelete(context, commentId);
    }
    return fail("方法不允许", 405);
}

export async function handleDiaryComments(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (
        segments.length === 3 &&
        segments[1] === "comments" &&
        segments[2] === "preview"
    ) {
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        return await runWithDirectusUserAccess(required.accessToken, async () =>
            handleCommentPreview(context, "can_comment_diaries"),
        );
    }

    if (segments.length === 3 && segments[2] === "comments") {
        const diaryId = parseRouteId(segments[1]);
        if (!diaryId) {
            return fail("缺少日记 ID", 400);
        }
        if (context.request.method === "GET") {
            return await runWithDirectusPublicAccess(async () =>
                handleDiaryCommentListOrCreate(context, diaryId),
            );
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        return await runWithDirectusUserAccess(required.accessToken, async () =>
            handleDiaryCommentListOrCreate(context, diaryId),
        );
    }

    if (segments.length === 3 && segments[1] === "comments") {
        const commentId = parseRouteId(segments[2]);
        if (!commentId) {
            return fail("缺少评论 ID", 400);
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        return await runWithDirectusUserAccess(required.accessToken, async () =>
            handleDiaryCommentById(context, commentId),
        );
    }

    return fail("未找到接口", 404);
}
