import type { APIContext } from "astro";

import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import {
    createOne,
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
import { CreateCommentSchema, UpdateCommentSchema } from "@/server/api/schemas";

import {
    invalidateArticleInteractionAggregate,
    parseRouteId,
    requireAccess,
} from "./shared";
import {
    buildDecoratedCommentTree,
    buildCommentUpdatePayload,
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

async function handleArticleCommentGet(
    context: APIContext,
    articleId: string,
): Promise<Response> {
    const article = await readOneById("app_articles", articleId);
    if (!article) {
        return fail("文章不存在", 404);
    }
    if (!(article.status === "published" && article.is_public)) {
        return fail("文章不可见", 404);
    }

    const pagination = parseCommentPagination(context.url);
    const pagedComments = await loadPaginatedComments(
        "app_article_comments",
        "article_id",
        articleId,
        pagination,
    );

    const tree = await buildDecoratedCommentTree(
        context,
        pagedComments.comments,
        "app_article_comment_likes",
        "article",
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

async function handleArticleCommentPost(
    context: APIContext,
    articleId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    assertCan(access, "can_comment_articles");

    const article = await readOneById("app_articles", articleId);
    if (!article) {
        return fail("文章不存在", 404);
    }
    if (!(article.status === "published" && article.is_public)) {
        return fail("文章不存在或不可见", 404);
    }
    if (!article.allow_comments) {
        return fail("该文章已关闭评论", 403);
    }

    const body = await parseJsonBody(context.request);
    const input = validateBody(CreateCommentSchema, body);
    if (input.parent_id) {
        const parentValidationError = await validateReplyParent(
            "app_article_comments",
            input.parent_id,
            articleId,
            "article_id",
        );
        if (parentValidationError) {
            return parentValidationError;
        }
    }

    const created = await createOne("app_article_comments", {
        status: input.status,
        article_id: articleId,
        author_id: access.user.id,
        parent_id: input.parent_id,
        body: input.body,
        is_public: input.is_public,
        show_on_profile: input.show_on_profile,
    });
    await syncMarkdownFilesToVisibility(
        created.body,
        access.user.id,
        created.is_public ? "public" : "private",
    );
    await awaitCacheInvalidations(
        [
            cacheManager.invalidate("article-detail", articleId),
            invalidateArticleInteractionAggregate(articleId),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "comments-article#create" },
    );
    return ok({
        item: await renderCommentItem(created),
    });
}

async function handleArticleCommentListOrCreate(
    context: APIContext,
    articleId: string,
): Promise<Response> {
    if (context.request.method === "GET") {
        return handleArticleCommentGet(context, articleId);
    }
    if (context.request.method === "POST") {
        return handleArticleCommentPost(context, articleId);
    }
    return fail("方法不允许", 405);
}

async function handleArticleCommentPatch(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    const comment = await readOneById("app_article_comments", commentId);
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
    const updated = await updateOne("app_article_comments", commentId, payload);
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
            cacheManager.invalidate("article-detail", comment.article_id),
            invalidateArticleInteractionAggregate(comment.article_id),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "comments-article#patch" },
    );
    return ok({
        item: await renderCommentItem(updated),
    });
}

async function handleArticleCommentDelete(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    const comment = await readOneById("app_article_comments", commentId);
    if (!comment) {
        return fail("评论不存在", 404);
    }
    assertOwnerOrAdmin(access, comment.author_id);

    await deleteCommentWithDescendants("app_article_comments", commentId);
    await awaitCacheInvalidations(
        [
            cacheManager.invalidate("article-detail", comment.article_id),
            invalidateArticleInteractionAggregate(comment.article_id),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "comments-article#delete" },
    );
    return ok({ id: commentId });
}

async function handleArticleCommentById(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    if (context.request.method === "PATCH") {
        return handleArticleCommentPatch(context, commentId);
    }
    if (context.request.method === "DELETE") {
        return handleArticleCommentDelete(context, commentId);
    }
    return fail("方法不允许", 405);
}

export async function handleArticleComments(
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
            handleCommentPreview(context, "can_comment_articles"),
        );
    }

    if (segments.length === 3 && segments[2] === "comments") {
        const articleId = parseRouteId(segments[1]);
        if (!articleId) {
            return fail("缺少文章 ID", 400);
        }
        if (context.request.method === "GET") {
            return await runWithDirectusPublicAccess(async () =>
                handleArticleCommentListOrCreate(context, articleId),
            );
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        return await runWithDirectusUserAccess(required.accessToken, async () =>
            handleArticleCommentListOrCreate(context, articleId),
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
            handleArticleCommentById(context, commentId),
        );
    }

    return fail("未找到接口", 404);
}
