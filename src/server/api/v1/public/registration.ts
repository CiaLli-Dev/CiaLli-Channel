import type { APIContext } from "astro";

import {
    cancelPublicRegistration,
    checkPublicRegistrationAvailability,
    createPublicRegistration,
    loadAuthorizedRegistrationAvatar,
    replacePublicRegistrationAvatar,
} from "@/server/application/registration/public-registration.service";
import { AppError, badRequest, notFound } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody } from "@/server/api/utils";
import {
    clearRegistrationRequestCookie,
    normalizeRegistrationRequestId,
    REGISTRATION_REQUEST_COOKIE_NAME,
    setRegistrationRequestCookie,
} from "@/server/auth/registration-request-cookie";
import { getClientIp } from "@/server/directus-auth";
import {
    applyRateLimit,
    rateLimitResponse,
} from "@/server/security/rate-limit";

import { toDirectusAssetQuery } from "../shared/helpers";
import { parseRouteId } from "../shared/parse";

function assertRegisterEnabled(context: APIContext): void {
    const enabled = Boolean(
        context.locals.siteSettings?.settings.auth?.register_enabled,
    );
    if (!enabled) {
        throw notFound("REGISTER_DISABLED", "资源不存在");
    }
}

async function handleRegistrationCreate(
    context: APIContext,
): Promise<Response> {
    assertRegisterEnabled(context);
    const formData = await context.request.formData();
    const avatarRaw = formData.get("avatar");
    const created = await createPublicRegistration({
        email: formData.get("email"),
        username: formData.get("username"),
        displayName: formData.get("display_name"),
        password: formData.get("password"),
        registrationReason: formData.get("registration_reason"),
        avatar: avatarRaw instanceof File ? avatarRaw : null,
    });

    if (created?.id) {
        setRegistrationRequestCookie(context, created.id);
    }

    return ok({ item: created });
}

async function handleRegistrationCancel(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    assertRegisterEnabled(context);

    const requestId = parseRouteId(segments[2]);
    if (!requestId) {
        return fail("缺少申请 ID", 400);
    }
    const cookieRequestId = normalizeRegistrationRequestId(
        context.cookies.get(REGISTRATION_REQUEST_COOKIE_NAME)?.value,
    );

    const body = await parseJsonBody(context.request);
    const action = String(body.action || "").trim();
    if (action !== "cancel") {
        throw badRequest("REGISTRATION_ACTION_INVALID", "不支持的申请操作");
    }

    const updated = await cancelPublicRegistration({
        requestId,
        cookieRequestId,
    });

    return ok({ item: updated });
}

function buildAvatarResponseHeaders(upstreamResponse: Response): Headers {
    const headers = new Headers();
    const contentType = upstreamResponse.headers.get("content-type");
    const contentLength = upstreamResponse.headers.get("content-length");
    const etag = upstreamResponse.headers.get("etag");
    const lastModified = upstreamResponse.headers.get("last-modified");

    if (contentType) {
        headers.set("content-type", contentType);
    }
    if (contentLength) {
        headers.set("content-length", contentLength);
    }
    if (etag) {
        headers.set("etag", etag);
    }
    if (lastModified) {
        headers.set("last-modified", lastModified);
    }
    headers.set("cache-control", "private, no-store");
    return headers;
}

async function handleRegistrationAvatarReplace(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    assertRegisterEnabled(context);

    const requestId = parseRouteId(segments[2]);
    if (!requestId) {
        return fail("缺少申请 ID", 400);
    }

    const cookieRequestId = normalizeRegistrationRequestId(
        context.cookies.get(REGISTRATION_REQUEST_COOKIE_NAME)?.value,
    );
    const formData = await context.request.formData();
    const avatar = formData.get("avatar");
    if (!(avatar instanceof File)) {
        return fail("缺少头像文件", 400);
    }

    const updated = await replacePublicRegistrationAvatar({
        requestId,
        cookieRequestId,
        avatar,
    });

    return ok({ item: updated });
}

async function handleRegistrationAvatarPreview(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    assertRegisterEnabled(context);

    const requestId = parseRouteId(segments[2]);
    if (!requestId) {
        return fail("缺少申请 ID", 400);
    }

    const cookieRequestId = normalizeRegistrationRequestId(
        context.cookies.get(REGISTRATION_REQUEST_COOKIE_NAME)?.value,
    );

    try {
        const response = await loadAuthorizedRegistrationAvatar({
            requestId,
            cookieRequestId,
            query: toDirectusAssetQuery(context.url.searchParams),
        });
        if (!response.ok) {
            if (response.status === 403 || response.status === 404) {
                return fail("资源不存在", 404);
            }
            return fail("资源获取失败", response.status);
        }
        return new Response(response.body, {
            status: 200,
            headers: buildAvatarResponseHeaders(response),
        });
    } catch (error) {
        if (
            error instanceof AppError &&
            (error.status === 403 || error.status === 404)
        ) {
            return fail("资源不存在", 404);
        }
        throw error;
    }
}

export async function handlePublicRegistrationRequests(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (segments.length === 2) {
        if (context.request.method !== "POST") {
            return fail("方法不允许", 405);
        }
        return handleRegistrationCreate(context);
    }

    if (segments.length === 3) {
        if (context.request.method !== "PATCH") {
            return fail("方法不允许", 405);
        }
        return handleRegistrationCancel(context, segments);
    }

    if (segments.length === 4 && segments[3] === "avatar") {
        if (context.request.method === "GET") {
            return handleRegistrationAvatarPreview(context, segments);
        }
        if (context.request.method !== "PATCH") {
            return fail("方法不允许", 405);
        }
        return handleRegistrationAvatarReplace(context, segments);
    }

    return fail("未找到接口", 404);
}

export async function handlePublicRegistrationCheck(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (segments.length !== 2) {
        return fail("未找到接口", 404);
    }
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    const ip = getClientIp(context.request.headers);
    const rateResult = await applyRateLimit(ip, "registration-check");
    if (!rateResult.ok) {
        return rateLimitResponse(rateResult);
    }

    assertRegisterEnabled(context);
    const emailRaw = String(context.url.searchParams.get("email") || "").trim();
    const usernameRaw = String(
        context.url.searchParams.get("username") || "",
    ).trim();
    if (!emailRaw && !usernameRaw) {
        return fail("至少提供邮箱或用户名", 400);
    }

    return ok(
        await checkPublicRegistrationAvailability({
            emailRaw: emailRaw || undefined,
            usernameRaw: usernameRaw || undefined,
        }),
    );
}

export async function handlePublicRegistrationSession(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (segments.length !== 2) {
        return fail("未找到接口", 404);
    }
    if (context.request.method !== "DELETE") {
        return fail("方法不允许", 405);
    }
    clearRegistrationRequestCookie(context);
    return ok({
        cleared: true,
    });
}
