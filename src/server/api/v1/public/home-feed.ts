import type { APIContext } from "astro";

import { fail, ok } from "@/server/api/response";
import {
    buildHomeFeedPage,
    DEFAULT_HOME_FEED_PAGE_LIMIT,
    DEFAULT_HOME_FEED_TOTAL_LIMIT,
    MAX_HOME_FEED_PAGE_LIMIT,
} from "@/server/application/feed/home-feed.service";
import { getSessionUser } from "@/server/auth/session";
import type { HomeFeedPageResponse } from "@/server/recommendation/home-feed.types";
import {
    DIRECTUS_ACCESS_COOKIE_NAME,
    DIRECTUS_REFRESH_COOKIE_NAME,
} from "@/server/directus-auth";

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
        DEFAULT_HOME_FEED_PAGE_LIMIT,
    );
    const limit = Math.min(MAX_HOME_FEED_PAGE_LIMIT, Math.max(1, parsedLimit));

    const sessionUser = hasAuthCookies(context)
        ? await getSessionUser(context)
        : null;
    const result: HomeFeedPageResponse = await buildHomeFeedPage({
        viewerId: sessionUser?.id ?? null,
        viewerRoleName: sessionUser?.roleName ?? null,
        isViewerSystemAdmin: sessionUser?.isSystemAdmin ?? false,
        offset,
        pageLimit: limit,
        totalLimit: DEFAULT_HOME_FEED_TOTAL_LIMIT,
    });
    return ok(result);
}
