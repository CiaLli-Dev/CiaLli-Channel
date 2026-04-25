import type { APIContext } from "astro";

import {
    AppError,
    badRequest,
    conflict,
    forbidden,
    notFound,
} from "@/server/api/errors";
import { createManagedUpload } from "@/server/application/uploads/upload.service";
import { DIRECTUS_ROLE_NAME } from "@/server/auth/directus-access";
import { loadDirectusAccessRegistry } from "@/server/auth/directus-registry";
import {
    normalizeRequestedUsername,
    validateDisplayName,
} from "@/server/auth/username";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup";
import {
    clearRegistrationRequestCookie,
    normalizeRegistrationRequestId,
} from "@/server/auth/registration-request-cookie";
import { syncManagedFileBinding } from "@/server/api/v1/me/_helpers";
import {
    cancelPendingRegistration,
    createPendingRegistrationUser,
    createRegistrationRequestItem,
    deleteRegistrationRequest,
    deletePendingRegistrationUser,
    findPendingRegistrationById,
    loadRegistrationSnapshot,
    readRegistrationAvatarAssetResponse,
    registrationEmailExists,
    registrationHasPendingConflict,
    registrationUsernameExists,
    setRegistrationRequestAvatar,
    type RegistrationRequestSnapshot,
} from "@/server/repositories/registration/public-registration.repository";
import type { AppUserRegistrationRequest } from "@/types/app";

const REGISTRATION_REASON_MAX_LENGTH = 500;
const REGISTRATION_PASSWORD_MIN_LENGTH = 8;
const REGISTRATION_PASSWORD_MAX_LENGTH = 20;
const REGISTRATION_PASSWORD_ALLOWED_PATTERN = /^[A-Za-z0-9@_]+$/;

export type RegistrationFieldCheckResult = {
    valid: boolean;
    available: boolean;
    code: string;
    message: string;
};

export type CreateRegistrationCommand = {
    email: unknown;
    username: unknown;
    displayName: unknown;
    password: unknown;
    registrationReason: unknown;
    avatar: File | null;
};

export type RegistrationPageState = {
    currentRegistration: RegistrationRequestSnapshot | null;
    hiddenBySessionMismatch: boolean;
    shouldClearCookie: boolean;
};

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

function assertAvatarReplaceAllowedStatus(status: string): void {
    if (status !== "pending" && status !== "rejected") {
        throw conflict(
            "REGISTRATION_STATUS_CONFLICT",
            "申请状态冲突，请刷新后重试",
        );
    }
}

async function throwUploadError(response: Response): Promise<never> {
    let message = "头像上传失败";
    let code = "REGISTRATION_AVATAR_UPLOAD_FAILED";
    try {
        const payload = (await response.json()) as {
            error?: { code?: string; message?: string };
        };
        if (payload.error?.message) {
            message = String(payload.error.message);
        }
        if (payload.error?.code) {
            code = String(payload.error.code);
        }
    } catch {
        // ignore
    }
    throw new AppError(code, message, response.status);
}

async function uploadRegistrationAvatar(file: File): Promise<string> {
    const uploaded = await createManagedUpload({
        authorization: {
            purpose: "registration-avatar",
            ownerUserId: null,
        },
        file,
        targetFormat: "",
        requestedTitle: "",
    });
    if (uploaded instanceof Response) {
        return await throwUploadError(uploaded);
    }
    return uploaded.file.id;
}

async function assertRegistrationEmailAvailable(email: string): Promise<void> {
    if (await registrationEmailExists(email)) {
        throw conflict("EMAIL_EXISTS", "邮箱已存在");
    }
}

async function assertRegistrationUsernameAvailable(
    username: string,
): Promise<void> {
    if (await registrationUsernameExists(username)) {
        throw conflict("USERNAME_EXISTS", "用户名已存在");
    }
}

async function assertNoPendingRegistrationConflict(params: {
    email?: string;
    username?: string;
}): Promise<void> {
    if (await registrationHasPendingConflict(params)) {
        throw conflict(
            "REGISTRATION_REQUEST_EXISTS",
            "该邮箱或用户名已有待处理申请",
        );
    }
}

export function mapRegistrationCheckError(
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

/**
 * 公开注册创建流程：统一处理字段校验、冲突检查、预创建 Directus 用户与申请单写入。
 */
export async function createPublicRegistration(
    command: CreateRegistrationCommand,
): Promise<AppUserRegistrationRequest> {
    const email = parseRegistrationEmail(command.email);
    const username = normalizeRequestedUsername(
        String(command.username || "").trim(),
    );
    const displayName = validateDisplayName(
        String(command.displayName || "").trim(),
    );
    const registrationPassword = parseRegistrationPassword(command.password);
    const registrationReason = parseRegistrationReason(
        command.registrationReason,
    );

    await assertNoPendingRegistrationConflict({ email, username });
    await Promise.all([
        assertRegistrationEmailAvailable(email),
        assertRegistrationUsernameAvailable(username),
    ]);

    const registry = await loadDirectusAccessRegistry();
    const memberRoleId = registry.roleIdByName.get(DIRECTUS_ROLE_NAME.member);
    if (!memberRoleId) {
        throw notFound("DIRECTUS_MEMBER_ROLE_MISSING", "缺少 Member 角色");
    }

    const pendingUser = await createPendingRegistrationUser({
        email,
        password: registrationPassword,
        displayName,
        memberRoleId,
    });

    let createdRequest: AppUserRegistrationRequest | null = null;
    try {
        createdRequest = await createRegistrationRequestItem({
            email,
            username,
            displayName,
            avatarFile: null,
            registrationReason,
            pendingUserId: pendingUser.id,
        });

        if (command.avatar) {
            const uploadedAvatarFileId = await uploadRegistrationAvatar(
                command.avatar,
            );
            createdRequest = await setRegistrationRequestAvatar({
                requestId: createdRequest.id,
                avatarFileId: uploadedAvatarFileId,
            });
            await syncManagedFileBinding({
                previousFileValue: null,
                nextFileValue: uploadedAvatarFileId,
                userId: pendingUser.id,
                visibility: "private",
                reference: {
                    ownerCollection: "app_user_registration_requests",
                    ownerId: createdRequest.id,
                    ownerField: "avatar_file",
                    referenceKind: "structured_field",
                },
            });
        }

        return createdRequest;
    } catch (error) {
        if (createdRequest?.id) {
            await deleteRegistrationRequest(createdRequest.id).catch(
                (cleanupError) => {
                    console.error(
                        "[registration] 补偿删除申请失败, requestId:",
                        createdRequest?.id,
                        cleanupError,
                    );
                },
            );
        }
        await deletePendingRegistrationUser(pendingUser.id).catch(
            (cleanupError) => {
                console.error(
                    "[registration] 补偿删除 draft 用户失败, pendingUserId:",
                    pendingUser.id,
                    cleanupError,
                );
            },
        );
        throw error;
    }
}

export async function cancelPublicRegistration(params: {
    requestId: string;
    cookieRequestId: string | null;
}): Promise<AppUserRegistrationRequest> {
    if (
        !params.cookieRequestId ||
        params.cookieRequestId !== params.requestId
    ) {
        throw forbidden(
            "REGISTRATION_REQUEST_FORBIDDEN",
            "无法操作当前申请，请刷新后重试",
        );
    }

    const target = await findPendingRegistrationById(params.requestId);
    if (!target) {
        throw notFound("REGISTRATION_NOT_FOUND", "申请不存在");
    }
    if (String(target.request_status || "").trim() !== "pending") {
        throw conflict(
            "REGISTRATION_STATUS_CONFLICT",
            "申请状态冲突，请刷新后重试",
        );
    }

    const pendingUserId = String(target.pending_user_id || "").trim();
    if (pendingUserId) {
        await deletePendingRegistrationUser(pendingUserId);
    }

    const updated = await cancelPendingRegistration({
        requestId: params.requestId,
        reviewedAt: new Date().toISOString(),
    });
    await syncManagedFileBinding({
        previousFileValue: target.avatar_file,
        nextFileValue: null,
        userId: pendingUserId || null,
        visibility: "private",
        reference: {
            ownerCollection: "app_user_registration_requests",
            ownerId: params.requestId,
            ownerField: "avatar_file",
            referenceKind: "structured_field",
        },
    });
    return updated;
}

export async function replacePublicRegistrationAvatar(params: {
    requestId: string;
    cookieRequestId: string | null;
    avatar: File;
}): Promise<AppUserRegistrationRequest> {
    if (
        !params.cookieRequestId ||
        params.cookieRequestId !== params.requestId
    ) {
        throw forbidden(
            "REGISTRATION_REQUEST_FORBIDDEN",
            "无法操作当前申请，请刷新后重试",
        );
    }

    const target = await findPendingRegistrationById(params.requestId);
    if (!target) {
        throw notFound("REGISTRATION_NOT_FOUND", "申请不存在");
    }

    assertAvatarReplaceAllowedStatus(
        String(target.request_status || "").trim(),
    );

    const nextAvatarFileId = await uploadRegistrationAvatar(params.avatar);
    const updated = await setRegistrationRequestAvatar({
        requestId: params.requestId,
        avatarFileId: nextAvatarFileId,
    });
    await syncManagedFileBinding({
        previousFileValue: target.avatar_file,
        nextFileValue: nextAvatarFileId,
        userId: String(target.pending_user_id ?? "").trim(),
        visibility: "private",
        reference: {
            ownerCollection: "app_user_registration_requests",
            ownerId: params.requestId,
            ownerField: "avatar_file",
            referenceKind: "structured_field",
        },
    });
    return updated;
}

export async function loadAuthorizedRegistrationAvatar(params: {
    requestId: string;
    cookieRequestId: string | null;
    query?: Partial<
        Record<"width" | "height" | "fit" | "quality" | "format", string>
    >;
}): Promise<Response> {
    if (
        !params.cookieRequestId ||
        params.cookieRequestId !== params.requestId
    ) {
        throw notFound("REGISTRATION_NOT_FOUND", "申请不存在");
    }

    const target = await findPendingRegistrationById(params.requestId);
    if (!target) {
        throw notFound("REGISTRATION_NOT_FOUND", "申请不存在");
    }

    const avatarFileId = normalizeDirectusFileId(target.avatar_file);
    if (!avatarFileId) {
        throw notFound("REGISTRATION_AVATAR_NOT_FOUND", "头像不存在");
    }

    return await readRegistrationAvatarAssetResponse({
        fileId: avatarFileId,
        query: params.query,
    });
}

export async function checkPublicRegistrationAvailability(params: {
    emailRaw?: string;
    usernameRaw?: string;
}): Promise<{
    email?: RegistrationFieldCheckResult;
    username?: RegistrationFieldCheckResult;
}> {
    const result: {
        email?: RegistrationFieldCheckResult;
        username?: RegistrationFieldCheckResult;
    } = {};

    if (params.emailRaw) {
        try {
            const email = parseRegistrationEmail(params.emailRaw);
            await Promise.all([
                assertRegistrationEmailAvailable(email),
                assertNoPendingRegistrationConflict({ email }),
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

    if (params.usernameRaw) {
        try {
            const username = normalizeRequestedUsername(params.usernameRaw);
            await Promise.all([
                assertRegistrationUsernameAvailable(username),
                assertNoPendingRegistrationConflict({ username }),
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

    return result;
}

export async function loadRegistrationPageState(params: {
    requestIdCookie: string | undefined;
    sessionUserId: string | null;
    context: APIContext;
}): Promise<RegistrationPageState> {
    const requestId = normalizeRegistrationRequestId(params.requestIdCookie);
    if (!requestId) {
        return {
            currentRegistration: null,
            hiddenBySessionMismatch: false,
            shouldClearCookie: false,
        };
    }

    let currentRegistration = await loadRegistrationSnapshot(requestId);
    let hiddenBySessionMismatch = false;

    if (currentRegistration && params.sessionUserId) {
        const approvedUserId = String(
            currentRegistration.approved_user_id || "",
        ).trim();
        const canDisplayApprovedSelfStatus =
            currentRegistration.request_status === "approved" &&
            approvedUserId &&
            approvedUserId === params.sessionUserId;
        if (!canDisplayApprovedSelfStatus) {
            currentRegistration = null;
            hiddenBySessionMismatch = true;
        }
    }

    const shouldClearCookie = !currentRegistration && !hiddenBySessionMismatch;
    if (shouldClearCookie) {
        clearRegistrationRequestCookie(params.context);
    }

    return {
        currentRegistration,
        hiddenBySessionMismatch,
        shouldClearCookie,
    };
}
