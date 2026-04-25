import type { APIContext } from "astro";

import {
    handleArticleCommentCollection,
    handleArticleCommentEntity,
} from "@/server/application/comments/article-comments.service";
import { fail } from "@/server/api/response";
import {
    withPublicRepositoryContext,
    withUserRepositoryContext,
} from "@/server/repositories/directus/scope";

import { requireAccess } from "./shared/auth";
import { parseRouteId } from "./shared/parse";
import { handleCommentPreview } from "./comments-shared";

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
        return await withUserRepositoryContext(required.accessToken, async () =>
            handleCommentPreview(context, "can_comment_articles"),
        );
    }

    if (segments.length === 3 && segments[2] === "comments") {
        const articleId = parseRouteId(segments[1]);
        if (!articleId) {
            return fail("缺少文章 ID", 400);
        }
        if (context.request.method === "GET") {
            return await withPublicRepositoryContext(async () =>
                handleArticleCommentCollection(context, articleId),
            );
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        return await withUserRepositoryContext(required.accessToken, async () =>
            handleArticleCommentCollection(context, articleId),
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
        return await withUserRepositoryContext(required.accessToken, async () =>
            handleArticleCommentEntity(context, commentId),
        );
    }

    return fail("未找到接口", 404);
}
