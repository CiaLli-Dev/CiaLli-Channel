import type { APIContext } from "astro";

import { fail } from "@/server/api/response";
import { withUserRepositoryContext } from "@/server/repositories/directus/scope";

import { requireAccess } from "../shared";
import type { AppAccess } from "../shared";
import { handleMeProfile } from "./profile";
import { handleMePrivacy, handleMePermissions } from "./privacy";
import { handleMeBlocks } from "./blocks";
import {
    handleMeArticleCommentLikes,
    handleMeArticleLikes,
    handleMeDiaryCommentLikes,
    handleMeDiaryLikes,
} from "./likes";
import { handleMeArticles } from "./articles";
import { handleMeDiaries, handleMeDiaryImages } from "./diaries";
import { handleMeAlbums, handleMeAlbumPhotos } from "./albums";

type SimpleHandler = (
    context: APIContext,
    access: AppAccess,
) => Promise<Response>;

type SegmentsHandler = (
    context: APIContext,
    access: AppAccess,
    segments: string[],
) => Promise<Response>;

const SIMPLE_ROUTES: Record<string, SimpleHandler> = {
    profile: handleMeProfile,
    privacy: handleMePrivacy,
    permissions: handleMePermissions,
};

const SEGMENTS_ROUTES: Record<string, SegmentsHandler> = {
    blocks: handleMeBlocks,
    "article-likes": handleMeArticleLikes,
    "diary-likes": handleMeDiaryLikes,
    "article-comment-likes": handleMeArticleCommentLikes,
    "diary-comment-likes": handleMeDiaryCommentLikes,
    articles: handleMeArticles,
};

async function routeMeDiaries(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length >= 3 && segments[2] === "images") {
        return handleMeDiaryImages(context, access, segments);
    }
    if (segments.length >= 3 && segments[1] === "images") {
        return handleMeDiaryImages(context, access, segments);
    }
    return handleMeDiaries(context, access, segments);
}

async function routeMeAlbums(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length >= 3 && segments[2] === "photos") {
        return handleMeAlbumPhotos(context, access, segments);
    }
    if (segments.length >= 3 && segments[1] === "photos") {
        return handleMeAlbumPhotos(context, access, segments);
    }
    return handleMeAlbums(context, access, segments);
}

async function dispatchMeRoute(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length < 1) {
        return fail("未找到接口", 404);
    }

    const root = segments[0];

    const simpleHandler = SIMPLE_ROUTES[root];
    if (simpleHandler) {
        return simpleHandler(context, access);
    }

    const segmentsHandler = SEGMENTS_ROUTES[root];
    if (segmentsHandler) {
        return segmentsHandler(context, access, segments);
    }

    if (root === "diaries") {
        return routeMeDiaries(context, access, segments);
    }

    if (root === "albums") {
        return routeMeAlbums(context, access, segments);
    }

    return fail("未找到接口", 404);
}

export async function handleMe(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    return await withUserRepositoryContext(required.accessToken, async () =>
        dispatchMeRoute(context, access, segments),
    );
}
