import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import {
    createDirectusUser,
    createOne,
    deleteDirectusUser,
    readMany,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, toStringValue } from "@/server/api/utils";
import { DIRECTUS_ROLE_NAME } from "@/server/auth/directus-access";
import { loadDirectusAccessRegistry } from "@/server/auth/directus-registry";
import {
    normalizeRequestedUsername,
    validateDisplayName,
} from "@/server/auth/username";
import {
    clearRegistrationRequestCookie,
    normalizeRegistrationRequestId,
    REGISTRATION_REQUEST_COOKIE_NAME,
    setRegistrationRequestCookie,
} from "@/server/auth/registration-request-cookie";
import { badRequest, conflict, forbidden, notFound } from "@/server/api/errors";
import { getClientIp } from "@/server/directus-auth";
import {
    applyRateLimit,
    rateLimitResponse,
} from "@/server/security/rate-limit";

import { parseRouteId } from "../shared";

const REGISTRATION_REASON_MAX_LENGTH = 500;
const REGISTRATION_PASSWORD_MIN_LENGTH = 8;
const REGISTRATION_PASSWORD_MAX_LENGTH = 20;
const REGISTRATION_PASSWORD_ALLOWED_PATTERN = /^[A-Za-z0-9@_]+$/;

function assertRegisterEnabled(context: APIContext): void {
    const enabled = Boolean(
        context.locals.siteSettings?.settings.auth?.register_enabled,
    );
    if (!enabled) {
        throw notFound("REGISTER_DISABLED", "资源不存在");
    }
}

function parseRegistrationReason(raw: unknown): string {
    const reason = String(raw || "").trim();
    if (!reason) {
        throw badRequest("REGISTRATION_REASON_EMPTY", "注册理由不能为空");
    }
    if (reason.length > REGISTRATION_REASON_MAX_LENGTH) {
        throw badRequest(
            "REGISTRATION_REASON_TOO_LONG",
            "注册理由最多 500 字符",
        );
    }
    return reason;
}

function parseRegistrationPassword(raw: unknown): string {
    const password = String(raw ?? "");
    if (!password.trim()) {
        throw badRequest("REGISTRATION_PASSWORD_REQUIRED", "密码不能为空");
    }
    if (!REGISTRATION_PASSWORD_ALLOWED_PATTERN.test(password)) {
        throw badRequest(
            "REGISTRATION_PASSWORD_INVALID",
            "密码仅支持数字、字母、@ 和下划线",
        );
    }
    if (password.length < REGISTRATION_PASSWORD_MIN_LENGTH) {
        throw badRequest("REGISTRATION_PASSWORD_TOO_SHORT", "密码至少 8 位");
    }
    if (password.length > REGISTRATION_PASSWORD_MAX_LENGTH) {
        throw badRequest(
            "REGISTRATION_PASSWORD_TOO_LONG",
            "密码长度不能超过 20 位",
        );
    }
    return password;
}

function parseRegistrationEmail(raw: unknown): string {
    const email = String(raw || "")
        .trim()
        .toLowerCase();
    if (!email) {
        throw badRequest("EMAIL_EMPTY", "邮箱不能为空");
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        throw badRequest("EMAIL_INVALID", "邮箱格式不正确");
    }
    return email;
}

async function assertRegistrationEmailAvailable(email: string): Promise<void> {
    const rows = await readMany("directus_users", {
        filter: { email: { _eq: email } } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    if (rows.length > 0) {
        throw conflict("EMAIL_EXISTS", "邮箱已存在");
    }
}

async function assertRegistrationUsernameAvailable(
    username: string,
): Promise<void> {
    const rows = await readMany("app_user_profiles", {
        filter: { username: { _eq: username } } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    if (rows.length > 0) {
        throw conflict("USERNAME_EXISTS", "用户名已存在");
    }
}

async function assertNoPendingRegistrationConflict(
    email: string,
    username: string,
): Promise<void> {
    const rows = await readMany("app_user_registration_requests", {
        filter: {
            _and: [
                { request_status: { _eq: "pending" } },
                {
                    _or: [
                        { email: { _eq: email } },
                        { username: { _eq: username } },
                    ],
                },
            ],
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    if (rows.length > 0) {
        throw conflict(
            "REGISTRATION_REQUEST_EXISTS",
            "该邮箱或用户名已有待处理申请",
        );
    }
}

async function assertNoPendingRegistrationEmailConflict(
    email: string,
): Promise<void> {
    const rows = await readMany("app_user_registration_requests", {
        filter: {
            _and: [
                { request_status: { _eq: "pending" } },
                { email: { _eq: email } },
            ],
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    if (rows.length > 0) {
        throw conflict(
            "REGISTRATION_REQUEST_EXISTS",
            "该邮箱或用户名已有待处理申请",
        );
    }
}

async function assertNoPendingRegistrationUsernameConflict(
    username: string,
): Promise<void> {
    const rows = await readMany("app_user_registration_requests", {
        filter: {
            _and: [
                { request_status: { _eq: "pending" } },
                { username: { _eq: username } },
            ],
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    if (rows.length > 0) {
        throw conflict(
            "REGISTRATION_REQUEST_EXISTS",
            "该邮箱或用户名已有待处理申请",
        );
    }
}

type RegistrationFieldCheckResult = {
    valid: boolean;
    available: boolean;
    code: string;
    message: string;
};

function mapRegistrationCheckError(
    error: unknown,
): RegistrationFieldCheckResult {
    const message = String((error as Error)?.message ?? error);
    if (message.includes("EMAIL_EMPTY")) {
        return {
            valid: false,
            available: false,
            code: "EMAIL_EMPTY",
            message: "邮箱不能为空",
        };
    }
    if (message.includes("EMAIL_INVALID")) {
        return {
            valid: false,
            available: false,
            code: "EMAIL_INVALID",
            message: "邮箱格式不正确",
        };
    }
    if (message.includes("USERNAME_EMPTY")) {
        return {
            valid: false,
            available: false,
            code: "USERNAME_EMPTY",
            message: "用户名不能为空",
        };
    }
    if (message.includes("USERNAME_INVALID")) {
        return {
            valid: false,
            available: false,
            code: "USERNAME_INVALID",
            message: "用户名仅支持英文、数字、下划线和短横线",
        };
    }
    if (message.includes("USERNAME_TOO_LONG")) {
        return {
            valid: false,
            available: false,
            code: "USERNAME_TOO_LONG",
            message: "用户名最多 14 字符",
        };
    }
    if (message.includes("EMAIL_EXISTS")) {
        return {
            valid: true,
            available: false,
            code: "EMAIL_EXISTS",
            message: "邮箱已存在",
        };
    }
    if (message.includes("USERNAME_EXISTS")) {
        return {
            valid: true,
            available: false,
            code: "USERNAME_EXISTS",
            message: "用户名已存在",
        };
    }
    if (message.includes("REGISTRATION_REQUEST_EXISTS")) {
        return {
            valid: true,
            available: false,
            code: "REGISTRATION_REQUEST_EXISTS",
            message: "该邮箱或用户名已有待处理申请",
        };
    }
    throw error;
}

async function handleRegistrationCreate(
    context: APIContext,
): Promise<Response> {
    assertRegisterEnabled(context);
    const body = await parseJsonBody(context.request);
    const email = parseRegistrationEmail(body.email);
    const username = normalizeRequestedUsername(
        toStringValue(body.username).trim(),
    );
    const displayName = validateDisplayName(
        toStringValue(body.display_name).trim(),
    );
    const registrationPassword = parseRegistrationPassword(body.password);
    const registrationReason = parseRegistrationReason(
        body.registration_reason,
    );
    const avatarFileRaw = toStringValue(body.avatar_file).trim();
    const avatarFile = avatarFileRaw ? parseRouteId(avatarFileRaw) : null;

    await assertNoPendingRegistrationConflict(email, username);
    await Promise.all([
        assertRegistrationEmailAvailable(email),
        assertRegistrationUsernameAvailable(username),
    ]);

    const registry = await loadDirectusAccessRegistry();
    const memberRoleId = registry.roleIdByName.get(DIRECTUS_ROLE_NAME.member);
    if (!memberRoleId) {
        throw notFound("DIRECTUS_MEMBER_ROLE_MISSING", "缺少 Member 角色");
    }
    const pendingUser = await createDirectusUser({
        email,
        password: registrationPassword,
        first_name: displayName || undefined,
        status: "draft",
        role: memberRoleId,
        policies: [],
    });

    const created = await createOne("app_user_registration_requests", {
        status: "published",
        email,
        username,
        display_name: displayName,
        avatar_file: avatarFile,
        registration_reason: registrationReason,
        request_status: "pending",
        pending_user_id: pendingUser.id,
        reviewed_by: null,
        reviewed_at: null,
        reject_reason: null,
        approved_user_id: null,
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
    if (!cookieRequestId || cookieRequestId !== requestId) {
        throw forbidden(
            "REGISTRATION_REQUEST_FORBIDDEN",
            "无法操作当前申请，请刷新后重试",
        );
    }

    const body = await parseJsonBody(context.request);
    const action = String(body.action || "").trim();
    if (action !== "cancel") {
        throw badRequest("REGISTRATION_ACTION_INVALID", "不支持的申请操作");
    }

    const rows = await readMany("app_user_registration_requests", {
        filter: { id: { _eq: requestId } } as JsonObject,
        limit: 1,
        fields: ["id", "request_status", "pending_user_id"],
    });
    const target = rows[0];
    if (!target) {
        throw notFound("REGISTRATION_NOT_FOUND", "申请不存在");
    }
    if (String(target.request_status || "").trim() !== "pending") {
        throw conflict(
            "REGISTRATION_STATUS_CONFLICT",
            "申请状态冲突，请刷新后重试",
        );
    }
    const pendingUserId = parseRouteId(
        String(target.pending_user_id || "").trim(),
    );
    if (pendingUserId) {
        await deleteDirectusUser(pendingUserId).catch((error) => {
            console.warn("[registration] delete pending user failed:", error);
        });
    }

    const updated = await updateOne(
        "app_user_registration_requests",
        requestId,
        {
            request_status: "cancelled",
            reviewed_by: null,
            reviewed_at: new Date().toISOString(),
            pending_user_id: null,
            reject_reason: null,
        },
    );

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

    const result: {
        email?: RegistrationFieldCheckResult;
        username?: RegistrationFieldCheckResult;
    } = {};

    if (emailRaw) {
        try {
            const email = parseRegistrationEmail(emailRaw);
            await Promise.all([
                assertRegistrationEmailAvailable(email),
                assertNoPendingRegistrationEmailConflict(email),
            ]);
            result.email = {
                valid: true,
                available: true,
                code: "OK",
                message: "邮箱可用",
            };
        } catch (error) {
            result.email = mapRegistrationCheckError(error);
        }
    }

    if (usernameRaw) {
        try {
            const username = normalizeRequestedUsername(usernameRaw);
            await Promise.all([
                assertRegistrationUsernameAvailable(username),
                assertNoPendingRegistrationUsernameConflict(username),
            ]);
            result.username = {
                valid: true,
                available: true,
                code: "OK",
                message: "用户名可用",
            };
        } catch (error) {
            result.username = mapRegistrationCheckError(error);
        }
    }

    return ok(result);
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
