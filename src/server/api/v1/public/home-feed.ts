import type { APIContext } from "astro";

import { fail, ok } from "@/server/api/response";
import { getSessionUser } from "@/server/auth/session";
import { buildHomeFeed } from "@/server/recommendation/home-feed";
import type { HomeFeedPageResponse } from "@/server/recommendation/home-feed.types";
import {
    DIRECTUS_ACCESS_COOKIE_NAME,
    DIRECTUS_REFRESH_COOKIE_NAME,
} from "@/server/directus-auth";

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 20;
const HOME_FEED_TOTAL_LIMIT = 60;
const HOME_FEED_ARTICLE_CANDIDATE_LIMIT = 80;
const HOME_FEED_DIARY_CANDIDATE_LIMIT = 60;

function parseNonNegativeInt(value: string | null, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function hasAuthCookies(context: APIContext): boolean {
    return Boolean(
        context.cookies.get(DIRECTUS_ACCESS_COOKIE_NAME)?.value ||
        context.cookies.get(DIRECTUS_REFRESH_COOKIE_NAME)?.value,
    );
}

export async function handlePublicHomeFeed(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }
    if (segments.length !== 2) {
        return fail("未找到接口", 404);
    }

    const offset = parseNonNegativeInt(
        context.url.searchParams.get("offset"),
        0,
    );
    const parsedLimit = parseNonNegativeInt(
        context.url.searchParams.get("limit"),
        DEFAULT_PAGE_LIMIT,
    );
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parsedLimit));

    const sessionUser = hasAuthCookies(context)
        ? await getSessionUser(context)
        : null;
    const feed = await buildHomeFeed({
        viewerId: sessionUser?.id ?? null,
        limit: HOME_FEED_TOTAL_LIMIT,
        outputLimit: HOME_FEED_TOTAL_LIMIT,
        articleCandidateLimit: HOME_FEED_ARTICLE_CANDIDATE_LIMIT,
        diaryCandidateLimit: HOME_FEED_DIARY_CANDIDATE_LIMIT,
    });
    const items = feed.items.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    const result: HomeFeedPageResponse = {
        items,
        offset,
        limit,
        next_offset: nextOffset,
        has_more: nextOffset < feed.items.length,
        generated_at: feed.generatedAt,
        total: feed.items.length,
    };
    return ok(result);
}
