import type { APIContext } from "astro";

import { fail, ok } from "@/server/api/response";
import { getClientIp } from "@/server/directus-auth";
import { withErrorHandler } from "@/server/middleware/error-handler";
import { withPublicRepositoryContext } from "@/server/repositories/directus/scope";
import { assertCsrfToken } from "@/server/security/csrf";
import {
    applyRateLimit,
    rateLimitResponse,
    type RateLimitCategory,
} from "@/server/security/rate-limit";

import {
    handleAdminContent,
    handleAdminAi,
    handleAdminRegistrationRequests,
    handleAdminSettings,
    handleAdminUsers,
} from "./admin";
import { handleAuthenticatedAsset } from "./assets";
import { handleArticleComments, handleDiaryComments } from "./comments";
import { handleMe } from "./me";
import { handlePublic, handleUserHome } from "./public";
import { assertSameOrigin, isWriteMethod, parseSegments } from "./shared";
import { handleUploads } from "./uploads";

/** 根据路由前缀和方法映射限流分类 */
function resolveRateLimitCategory(
    segments: string[],
    _method: string,
): RateLimitCategory {
    const first = segments[0] ?? "";

    if (first === "uploads") return "upload";

    if (first === "articles" || first === "diaries") {
        const last = segments[segments.length - 1] ?? "";
        if (last === "comments") return "comment";
    }

    if (first === "admin") return "admin-write";

    return "write";
}

async function applyWriteGuards(context: APIContext): Promise<Response | null> {
    const denied = assertSameOrigin(context);
    if (denied) return denied;

    const csrfDenied = assertCsrfToken(context);
    if (csrfDenied) return csrfDenied;

    const ip = getClientIp(context.request.headers);
    const segments = parseSegments(context);
    const category = resolveRateLimitCategory(segments, context.request.method);
    const rl = await applyRateLimit(ip, category);
    if (!rl.ok) return rateLimitResponse(rl);

    return null;
}

async function dispatchAdminRoute(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (segments[1] === "users") {
        return handleAdminUsers(context, segments.slice(1));
    }
    if (segments[1] === "registration-requests") {
        return handleAdminRegistrationRequests(context, segments.slice(1));
    }
    if (segments[1] === "content") {
        return handleAdminContent(context, segments.slice(1));
    }
    if (segments[1] === "settings") {
        return handleAdminSettings(context, segments.slice(1));
    }
    if (segments[1] === "ai") {
        return handleAdminAi(context, segments.slice(1));
    }
    return fail("未找到接口", 404);
}

async function dispatchRoute(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (segments.length === 0) {
        return ok({ message: "ok" });
    }

    const first = segments[0];

    if (first === "public") {
        return await withPublicRepositoryContext(async () =>
            handlePublic(context, segments),
        );
    }
    if (first === "users") return handleUserHome(context, segments);
    if (first === "assets") return handleAuthenticatedAsset(context, segments);
    if (first === "me") return handleMe(context, segments.slice(1));
    if (first === "articles") return handleArticleComments(context, segments);
    if (first === "diaries") return handleDiaryComments(context, segments);
    if (first === "uploads") return handleUploads(context);
    if (first === "admin") return dispatchAdminRoute(context, segments);

    return fail("未找到接口", 404);
}

async function handleV1Inner(context: APIContext): Promise<Response> {
    if (isWriteMethod(context.request.method)) {
        const guardResponse = await applyWriteGuards(context);
        if (guardResponse) return guardResponse;
    }

    const segments = parseSegments(context);
    return dispatchRoute(context, segments);
}

export const handleV1: (context: APIContext) => Promise<Response> =
    withErrorHandler(handleV1Inner);
