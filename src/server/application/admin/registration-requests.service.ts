import type { APIContext } from "astro";

import type {
    AppPermissions,
    AppProfile,
    AppUserRegistrationRequest,
    RegistrationRequestStatus,
} from "@/types/app";
import type { JsonObject } from "@/types/json";

import {
    buildPermissionsFromDirectus,
    DIRECTUS_POLICY_NAME,
    DIRECTUS_ROLE_NAME,
} from "@/server/auth/directus-access";
import {
    invalidateDirectusAccessRegistry,
    loadDirectusAccessRegistry,
} from "@/server/auth/directus-registry";
import {
    normalizeRequestedUsername,
    validateDisplayName,
} from "@/server/auth/username";
import {
    countItems,
    deleteDirectusUser,
    readMany,
    syncDirectusUserPolicies,
    updateDirectusFileMetadata,
    updateDirectusUser,
    updateOne,
    createOne,
} from "@/server/directus/client";
import { badRequest, conflict, notFound } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import { withUserRepositoryContext } from "@/server/repositories/directus/scope";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { invalidateOfficialSidebarCache } from "@/server/api/v1/public-data";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup";

import {
    ensureUsernameAvailable,
    normalizeAppRole,
    normalizeRegistrationRequestStatus,
    parseBodyTextField,
    parseRouteId,
    requireAdmin,
} from "@/server/api/v1/shared";
import { invalidateAuthorCache } from "@/server/api/v1/shared/author-cache";

const REGISTRATION_REASON_MAX_LENGTH = 500;

function parseOptionalRegistrationReason(raw: unknown): string | null {
    const reason = String(raw ?? "").trim() || null;
    if (!reason) {
        return null;
    }
    if (reason.length > REGISTRATION_REASON_MAX_LENGTH) {
        throw badRequest(
            "REGISTRATION_REASON_TOO_LONG",
            "注册理由最多 500 字符",
        );
    }
    return reason;
}

type ManagedUserActivateResult = {
    user: { id: string };
    profile: AppProfile;
    permissions: AppPermissions;
};

function buildDefaultApprovedPolicyNames(): string[] {
    return [
        DIRECTUS_POLICY_NAME.publishArticles,
        DIRECTUS_POLICY_NAME.commentArticles,
        DIRECTUS_POLICY_NAME.manageDiaries,
        DIRECTUS_POLICY_NAME.commentDiaries,
        DIRECTUS_POLICY_NAME.manageAlbums,
        DIRECTUS_POLICY_NAME.uploadFiles,
    ];
}

async function ensureManagedProfile(params: {
    userId: string;
    requestedUsername: string;
    displayName: string;
    avatarFile?: string | null;
}): Promise<AppProfile> {
    await ensureUsernameAvailable(params.requestedUsername);
    return await createOne("app_user_profiles", {
        status: "published",
        user_id: params.userId,
        username: params.requestedUsername,
        display_name: params.displayName,
        header_file: null,
        profile_public: true,
        show_articles_on_profile: true,
        show_diaries_on_profile: true,
        show_bangumi_on_profile: true,
        show_albums_on_profile: true,
        show_comments_on_profile: true,
        bangumi_username: null,
        bangumi_include_private: false,
        bangumi_access_token_encrypted: null,
        social_links: null,
        home_section_order: null,
        is_official: false,
    });
}

async function activateManagedUser(params: {
    pendingUserId: string;
    requestedUsername: string;
    displayName: string;
    avatarFile?: string | null;
    appRole?: AppPermissions["app_role"];
}): Promise<ManagedUserActivateResult> {
    const registry = await loadDirectusAccessRegistry();
    const targetRoleName =
        normalizeAppRole(params.appRole || "member") === "admin"
            ? DIRECTUS_ROLE_NAME.siteAdmin
            : DIRECTUS_ROLE_NAME.member;
    const targetRoleId = registry.roleIdByName.get(targetRoleName);
    if (!targetRoleId) {
        throw badRequest(
            "DIRECTUS_ROLE_MISSING",
            `缺少 Directus 角色：${targetRoleName}`,
        );
    }
    const desiredPolicyIds =
        targetRoleName === DIRECTUS_ROLE_NAME.siteAdmin
            ? [
                  registry.policyIdByName.get(DIRECTUS_POLICY_NAME.siteAdmin) ||
                      "",
              ].filter(Boolean)
            : buildDefaultApprovedPolicyNames()
                  .map((name) => registry.policyIdByName.get(name) || "")
                  .filter(Boolean);

    const directusPayload: JsonObject = {
        status: "active",
        role: targetRoleId,
    };
    if (params.displayName) {
        directusPayload.first_name = params.displayName;
    }
    if (params.avatarFile) {
        directusPayload.avatar = params.avatarFile;
    }
    await updateDirectusUser(params.pendingUserId, directusPayload);
    let profile: AppProfile;
    try {
        await syncDirectusUserPolicies({
            userId: params.pendingUserId,
            currentAssignments: [],
            desiredPolicyIds,
        });
        profile = await ensureManagedProfile({
            userId: params.pendingUserId,
            requestedUsername: params.requestedUsername,
            displayName: params.displayName,
            avatarFile: params.avatarFile,
        });
    } catch (error) {
        await updateDirectusUser(params.pendingUserId, {
            status: "draft",
        }).catch((rollbackError) => {
            console.error(
                "[registration-approve] 补偿回退用户状态失败, userId:",
                params.pendingUserId,
                rollbackError,
            );
        });
        throw error;
    }

    const permissions = buildPermissionsFromDirectus({
        roleName: targetRoleName,
        policyNames:
            targetRoleName === DIRECTUS_ROLE_NAME.siteAdmin
                ? [DIRECTUS_POLICY_NAME.siteAdmin]
                : buildDefaultApprovedPolicyNames(),
        isPlatformAdmin: false,
    });

    invalidateAuthorCache(params.pendingUserId);
    invalidateOfficialSidebarCache();
    invalidateDirectusAccessRegistry();
    return {
        user: { id: params.pendingUserId },
        profile,
        permissions,
    };
}

async function readRegistrationRequestById(
    requestId: string,
): Promise<AppUserRegistrationRequest | null> {
    const rows = await readMany("app_user_registration_requests", {
        filter: { id: { _eq: requestId } } as JsonObject,
        limit: 1,
        fields: [
            "id",
            "email",
            "username",
            "display_name",
            "avatar_file",
            "registration_reason",
            "request_status",
            "pending_user_id",
            "reviewed_by",
            "reviewed_at",
            "reject_reason",
            "approved_user_id",
            "status",
            "sort",
            "user_created",
            "date_created",
            "user_updated",
            "date_updated",
        ],
    });
    return rows[0] || null;
}

function ensurePendingRegistrationStatus(
    status: RegistrationRequestStatus,
): void {
    if (status !== "pending") {
        throw conflict(
            "REGISTRATION_STATUS_CONFLICT",
            "申请状态冲突，请刷新后重试",
        );
    }
}

async function handleRegistrationRequestsGet(
    context: APIContext,
): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url);
    const statusRaw = String(
        context.url.searchParams.get("status") || "",
    ).trim();

    let statusFilter: RegistrationRequestStatus | null = null;
    if (statusRaw && statusRaw !== "all") {
        const normalized = normalizeRegistrationRequestStatus(
            statusRaw,
            "pending",
        );
        if (normalized !== statusRaw) {
            throw badRequest("REGISTRATION_STATUS_INVALID", "申请状态参数无效");
        }
        statusFilter = normalized;
    }

    const filter = statusFilter
        ? ({ request_status: { _eq: statusFilter } } as JsonObject)
        : undefined;
    const [items, total] = await Promise.all([
        readMany("app_user_registration_requests", {
            filter,
            sort: ["-date_created"],
            limit,
            offset,
            fields: [
                "id",
                "email",
                "username",
                "display_name",
                "avatar_file",
                "registration_reason",
                "request_status",
                "pending_user_id",
                "reviewed_by",
                "reviewed_at",
                "reject_reason",
                "approved_user_id",
                "status",
                "sort",
                "user_created",
                "date_created",
                "user_updated",
                "date_updated",
            ],
        }),
        countItems("app_user_registration_requests", filter),
    ]);

    return ok({ items, page, limit, total });
}

async function handleRegistrationApprove(
    target: AppUserRegistrationRequest,
    reviewedBy: string,
    reviewedAt: string,
): Promise<Response> {
    const pendingUserId = parseRouteId(
        String(target.pending_user_id || "").trim(),
    );
    if (!pendingUserId) {
        throw badRequest(
            "REGISTRATION_PENDING_USER_MISSING",
            "申请缺少待激活账号，请让用户重新提交申请",
        );
    }

    const created = await activateManagedUser({
        pendingUserId,
        requestedUsername: normalizeRequestedUsername(target.username),
        displayName: validateDisplayName(target.display_name),
        avatarFile: target.avatar_file,
        appRole: "member",
    });
    const registrationAvatarFileId = normalizeDirectusFileId(
        target.avatar_file,
    );
    if (registrationAvatarFileId) {
        await updateDirectusFileMetadata(registrationAvatarFileId, {
            uploaded_by: created.user.id,
            app_owner_user_id: created.user.id,
            app_visibility: "public",
        }).catch((error) => {
            console.warn(
                "[registration-approve] 更新头像文件元数据失败, fileId:",
                registrationAvatarFileId,
                error,
            );
        });
    }

    const updated = await updateOne(
        "app_user_registration_requests",
        target.id,
        {
            request_status: "approved",
            reviewed_by: reviewedBy,
            reviewed_at: reviewedAt,
            pending_user_id: null,
            approved_user_id: created.user.id,
            reject_reason: null,
        },
    ).catch((error) => {
        console.error(
            "[registration-approve] 更新申请记录状态失败, requestId:",
            target.id,
            "userId:",
            created.user.id,
            error,
        );
        return {
            ...target,
            request_status: "approved" as const,
            approved_user_id: created.user.id,
        };
    });
    return ok({
        item: updated,
        user: created.user,
        profile: created.profile,
        permissions: created.permissions,
    });
}

async function handleRegistrationRejectOrCancel(
    action: string,
    target: AppUserRegistrationRequest,
    reviewedBy: string,
    reviewedAt: string,
    body: JsonObject,
): Promise<Response> {
    const reason =
        action === "reject"
            ? parseOptionalRegistrationReason(body.reason)
            : null;
    const pendingUserId = parseRouteId(
        String(target.pending_user_id || "").trim(),
    );
    if (pendingUserId) {
        await deleteDirectusUser(pendingUserId).catch((error) => {
            console.warn(
                "[admin/registration-requests] delete pending user failed:",
                error,
            );
        });
    }
    const updated = await updateOne(
        "app_user_registration_requests",
        target.id,
        {
            request_status: action === "reject" ? "rejected" : "cancelled",
            reviewed_by: reviewedBy,
            reviewed_at: reviewedAt,
            pending_user_id: null,
            reject_reason: action === "reject" ? reason : null,
        },
    );
    return ok({ item: updated });
}

async function handleRegistrationRequestPatch(
    context: APIContext,
    reviewedBy: string,
    segments: string[],
): Promise<Response> {
    const requestId = parseRouteId(segments[1]);
    if (!requestId) {
        return fail("缺少申请 ID", 400);
    }
    const body = await parseJsonBody(context.request);
    const action = parseBodyTextField(body, "action");
    const target = await readRegistrationRequestById(requestId);
    if (!target) {
        throw notFound("REGISTRATION_NOT_FOUND", "申请不存在");
    }
    ensurePendingRegistrationStatus(
        normalizeRegistrationRequestStatus(target.request_status, "pending"),
    );

    const reviewedAt = new Date().toISOString();

    if (action === "approve") {
        return handleRegistrationApprove(target, reviewedBy, reviewedAt);
    }
    if (action === "reject" || action === "cancel") {
        return handleRegistrationRejectOrCancel(
            action,
            target,
            reviewedBy,
            reviewedAt,
            body as JsonObject,
        );
    }

    throw badRequest("REGISTRATION_ACTION_INVALID", "不支持的申请操作");
}

export async function handleAdminRegistrationRequests(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    return await withUserRepositoryContext(required.accessToken, async () => {
        if (segments.length === 1 && context.request.method === "GET") {
            return handleRegistrationRequestsGet(context);
        }

        if (segments.length === 2 && context.request.method === "PATCH") {
            return handleRegistrationRequestPatch(
                context,
                required.access.user.id,
                segments,
            );
        }

        return fail("未找到接口", 404);
    });
}
