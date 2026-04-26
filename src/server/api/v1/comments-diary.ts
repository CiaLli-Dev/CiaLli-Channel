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
import { isUuid } from "@/server/utils/short-id";

import { requireAccess } from "./shared/auth";
import { parseRouteId } from "./shared/parse";
import { handleCommentPreview } from "./comments-shared";

type ParsedRouteId = { id: string } | { response: Response };

function parseUuidRouteId(
    input: string | undefined,
    missingMessage: string,
    invalidMessage: string,
): ParsedRouteId {
    const id = parseRouteId(input);
    if (!id) {
        return { response: fail(missingMessage, 400) };
    }
    if (!isUuid(id)) {
        return { response: fail(invalidMessage, 400) };
    }
    return { id };
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
        return await withUserRepositoryContext(required.accessToken, async () =>
            handleCommentPreview(context, "can_comment_diaries"),
        );
    }

    if (segments.length === 3 && segments[2] === "comments") {
        const parsed = parseUuidRouteId(
            segments[1],
            "缺少日记 ID",
            "非法日记 ID",
        );
        if ("response" in parsed) {
            return parsed.response;
        }
        if (context.request.method === "GET") {
            return await withPublicRepositoryContext(async () =>
                handleDiaryCommentCollection(context, parsed.id),
            );
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        return await withUserRepositoryContext(required.accessToken, async () =>
            handleDiaryCommentCollection(context, parsed.id),
        );
    }

    if (segments.length === 3 && segments[1] === "comments") {
        const parsed = parseUuidRouteId(
            segments[2],
            "缺少评论 ID",
            "非法评论 ID",
        );
        if ("response" in parsed) {
            return parsed.response;
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        return await withUserRepositoryContext(required.accessToken, async () =>
            handleDiaryCommentEntity(context, parsed.id),
        );
    }

    return fail("未找到接口", 404);
}
