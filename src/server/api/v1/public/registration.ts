import type { APIContext } from "astro";

import {
    cancelPublicRegistration,
    checkPublicRegistrationAvailability,
    createPublicRegistration,
} from "@/server/application/registration/public-registration.service";
import { badRequest, notFound } from "@/server/api/errors";
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

import { parseRouteId } from "../shared";

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
    const body = await parseJsonBody(context.request);
    const created = await createPublicRegistration({
        email: body.email,
        username: body.username,
        displayName: body.display_name,
        password: body.password,
        registrationReason: body.registration_reason,
        avatarFile: parseRouteId(String(body.avatar_file || "").trim()),
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
