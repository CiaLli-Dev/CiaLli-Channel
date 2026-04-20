import type { APIContext } from "astro";

import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { CreateCommentSchema, UpdateCommentSchema } from "@/server/api/schemas";
import { fail, ok } from "@/server/api/response";
import { createOne, readOneById, updateOne } from "@/server/directus/client";
import {
    invalidateArticleInteractionAggregate,
    requireAccess,
} from "@/server/api/v1/shared";
import {
    buildCommentUpdatePayload,
    buildDecoratedCommentTree,
    deleteCommentWithDescendants,
    loadPaginatedComments,
    parseCommentPagination,
    renderCommentItem,
    validateReplyParent,
} from "@/server/api/v1/comments-shared";
import {
    cleanupOwnedOrphanDirectusFiles,
    extractDirectusAssetIdsFromMarkdown,
} from "@/server/api/v1/shared/file-cleanup";
import { syncMarkdownFilesToVisibility } from "@/server/api/v1/me/_helpers";

async function getArticleCommentList(
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

async function createArticleComment(
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
            cacheManager.invalidateByDomain("mixed-feed"),
        ],
        { label: "comments-article#create" },
    );
    return ok({
        item: await renderCommentItem(created),
    });
}

async function patchArticleComment(
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
            cacheManager.invalidateByDomain("mixed-feed"),
        ],
        { label: "comments-article#patch" },
    );
    return ok({
        item: await renderCommentItem(updated),
    });
}

async function deleteArticleComment(
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
            cacheManager.invalidateByDomain("mixed-feed"),
        ],
        { label: "comments-article#delete" },
    );
    return ok({ id: commentId });
}

export async function handleArticleCommentCollection(
    context: APIContext,
    articleId: string,
): Promise<Response> {
    if (context.request.method === "GET") {
        return await getArticleCommentList(context, articleId);
    }
    if (context.request.method === "POST") {
        return await createArticleComment(context, articleId);
    }
    return fail("方法不允许", 405);
}

export async function handleArticleCommentEntity(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    if (context.request.method === "PATCH") {
        return await patchArticleComment(context, commentId);
    }
    if (context.request.method === "DELETE") {
        return await deleteArticleComment(context, commentId);
    }
    return fail("方法不允许", 405);
}
