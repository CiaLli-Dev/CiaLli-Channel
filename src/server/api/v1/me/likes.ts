import type { APIContext } from "astro";

import {
    handleMyArticleCommentLikes,
    handleMyArticleLikes,
    handleMyDiaryCommentLikes,
    handleMyDiaryLikes,
} from "@/server/application/me/likes.service";

import type { AppAccess } from "../shared";

export async function handleMeArticleLikes(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyArticleLikes(context, access, segments);
}

export async function handleMeDiaryLikes(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyDiaryLikes(context, access, segments);
}

export async function handleMeArticleCommentLikes(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyArticleCommentLikes(context, access, segments);
}

export async function handleMeDiaryCommentLikes(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyDiaryCommentLikes(context, access, segments);
}
