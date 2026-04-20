import type { APIContext } from "astro";

import { fail } from "@/server/api/response";

import { handlePublicSiteSettings } from "./site-settings";
import { handlePublicAsset } from "./assets";
import { handlePublicArticles } from "./articles";
import { handlePublicDiaries } from "./diaries";
import { handlePublicFriends } from "./friends";
import { handlePublicAlbums } from "./albums";
import { handlePublicMixedFeed } from "./mixed-feed";
import {
    handlePublicRegistrationRequests,
    handlePublicRegistrationCheck,
    handlePublicRegistrationSession,
} from "./registration";
import { handleUserHome } from "./user-home";

const PUBLIC_EDGE_CACHE_CONTROL =
    "public, s-maxage=300, stale-while-revalidate=900";

function canApplyPublicEdgeCache(segments: string[]): boolean {
    const moduleName = segments[1] ?? "";
    return (
        moduleName === "articles" ||
        moduleName === "diaries" ||
        moduleName === "albums" ||
        moduleName === "friends" ||
        moduleName === "site-settings" ||
        moduleName === "mixed-feed"
    );
}

function withPublicEdgeCache(
    context: APIContext,
    segments: string[],
    response: Response,
): Response {
    if (context.request.method !== "GET") {
        return response;
    }
    if (!canApplyPublicEdgeCache(segments)) {
        return response;
    }
    if (!response.headers.has("Cache-Control")) {
        response.headers.set("Cache-Control", PUBLIC_EDGE_CACHE_CONTROL);
    }
    return response;
}

export async function handlePublic(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    let response: Response;
    if (segments[1] === "assets") {
        response = await handlePublicAsset(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "site-settings") {
        response = await handlePublicSiteSettings(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "registration-requests") {
        response = await handlePublicRegistrationRequests(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "registration-check") {
        response = await handlePublicRegistrationCheck(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "registration-session") {
        response = await handlePublicRegistrationSession(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "friends") {
        response = await handlePublicFriends(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "articles") {
        response = await handlePublicArticles(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "diaries") {
        response = await handlePublicDiaries(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "albums") {
        response = await handlePublicAlbums(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    if (segments[1] === "mixed-feed") {
        response = await handlePublicMixedFeed(context, segments);
        return withPublicEdgeCache(context, segments, response);
    }
    return withPublicEdgeCache(context, segments, fail("未找到接口", 404));
}

export { handleUserHome };
