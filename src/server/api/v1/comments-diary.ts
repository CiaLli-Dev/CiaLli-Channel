import type { APIContext } from "astro";

import {
    handleDiaryCommentCollection,
    handleDiaryCommentEntity,
} from "@/server/application/comments/diary-comments.service";
import { fail } from "@/server/api/response";
import {
    withPublicRepositoryContext,
    withUserRepositoryContext,
} from "@/server/repositories/directus/scope";

import { parseRouteId, requireAccess } from "./shared";
import { handleCommentPreview } from "./comments-shared";

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
        return await withUserRepositoryContext(required.accessToken, async () =>
            handleCommentPreview(context, "can_comment_diaries"),
        );
    }

    if (segments.length === 3 && segments[2] === "comments") {
        const diaryId = parseRouteId(segments[1]);
        if (!diaryId) {
            return fail("缺少日记 ID", 400);
        }
        if (context.request.method === "GET") {
            return await withPublicRepositoryContext(async () =>
                handleDiaryCommentCollection(context, diaryId),
            );
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        return await withUserRepositoryContext(required.accessToken, async () =>
            handleDiaryCommentCollection(context, diaryId),
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
            handleDiaryCommentEntity(context, commentId),
        );
    }

    return fail("未找到接口", 404);
}
