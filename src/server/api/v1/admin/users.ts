/* eslint-disable max-lines -- 用户管理聚合了角色、策略、资料与删除清理编排 */
import type { APIContext } from "astro";

import type {
    AppPermissions,
    AppProfile,
    AppProfileView,
    AppUser,
} from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    buildPermissionsFromDirectus,
    DIRECTUS_POLICY_NAME,
    DIRECTUS_ROLE_NAME,
    extractDirectusPolicyIds,
    extractDirectusRoleName,
    isPlatformAdministratorRoleName,
    resolvePolicyNames,
} from "@/server/auth/directus-access";
import {
    invalidateDirectusAccessRegistry,
    loadDirectusAccessRegistry,
} from "@/server/auth/directus-registry";
import { createUniqueUsername } from "@/server/auth/acl";
import { toAppProfileView } from "@/server/profile-view";
import {
    normalizeRequestedUsername,
    validateDisplayName,
} from "@/server/auth/username";
import {
    deleteDirectusUser,
    deleteOne,
    listDirectusUsers,
    readMany,
    readOneById,
    runWithDirectusUserAccess,
    syncDirectusUserPolicies,
    updateDirectusFileMetadata,
    updateDirectusUser,
    createOne,
    updateOne,
} from "@/server/directus/client";
import { cacheManager } from "@/server/cache/manager";
import { badRequest, forbidden } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import type { AdminUpdateUserInput } from "@/server/api/schemas";
import {
    AdminResetPasswordSchema,
    AdminUpdateUserSchema,
} from "@/server/api/schemas";
import { invalidateOfficialSidebarCache } from "../public-data";
import {
    cleanupOwnedOrphanDirectusFiles,
    collectReferencedDirectusFileIds,
    collectUserOwnedFileIds,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";

import {
    DEFAULT_LIST_LIMIT,
    ensureUsernameAvailable,
    hasOwn,
    normalizeAppRole,
    parseRouteId,
    parseProfileBioField,
    requireAdmin,
} from "../shared";
import { invalidateAuthorCache } from "../shared/author-cache";
import {
    clearBlockingUserReferences,
    loadReferencedFilesByUser,
    nullifyReferencedFileOwnership,
    nullifyRegistrationRequestAvatars,
} from "./users-helpers";

const MANAGED_POLICY_NAMES = [
    DIRECTUS_POLICY_NAME.publishArticles,
    DIRECTUS_POLICY_NAME.commentArticles,
    DIRECTUS_POLICY_NAME.manageDiaries,
    DIRECTUS_POLICY_NAME.commentDiaries,
    DIRECTUS_POLICY_NAME.manageAlbums,
    DIRECTUS_POLICY_NAME.uploadFiles,
] as const;

type AdminUserRow = {
    user: AppUser;
    profile: AppProfileView | null;
    permissions: AppPermissions;
    is_platform_admin: boolean;
    is_site_admin: boolean;
};

type DirectusUserSnapshot = {
    roleName: string | null;
    policyIds: string[];
    policyNames: string[];
    isPlatformAdmin: boolean;
};

function extractPermissionPatch(
    input: AdminUpdateUserInput,
): Partial<AppPermissions> {
    const payload: Partial<AppPermissions> = {};
    if (input.app_role !== undefined) {
        payload.app_role = normalizeAppRole(input.app_role);
    }
    if (input.can_publish_articles !== undefined) {
        payload.can_publish_articles = input.can_publish_articles;
    }
    if (input.can_comment_articles !== undefined) {
        payload.can_comment_articles = input.can_comment_articles;
    }
    if (input.can_manage_diaries !== undefined) {
        payload.can_manage_diaries = input.can_manage_diaries;
    }
    if (input.can_comment_diaries !== undefined) {
        payload.can_comment_diaries = input.can_comment_diaries;
    }
    if (input.can_manage_albums !== undefined) {
        payload.can_manage_albums = input.can_manage_albums;
    }
    if (input.can_upload_files !== undefined) {
        payload.can_upload_files = input.can_upload_files;
    }
    return payload;
}

async function ensureUserProfile(
    userId: string,
    fallbackName: string,
): Promise<AppProfile> {
    const rows = await readMany("app_user_profiles", {
        filter: { user_id: { _eq: userId } } as JsonObject,
        limit: 1,
    });
    if (rows[0]) {
        return rows[0];
    }

    const normalizedUsername = await createUniqueUsername(fallbackName);
    const created = await updateOrCreateProfile({
        userId,
        profileId: null,
        payload: {
            status: "published",
            user_id: userId,
            username: normalizedUsername,
            display_name: normalizedUsername,
            bio_typewriter_enable: true,
            bio_typewriter_speed: 80,
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
        },
    });
    invalidateAuthorCache(userId);
    return created;
}

async function updateOrCreateProfile(params: {
    userId: string;
    profileId: string | null;
    payload: JsonObject;
}): Promise<AppProfile> {
    if (params.profileId) {
        return await updateOne(
            "app_user_profiles",
            params.profileId,
            params.payload,
        );
    }
    return await createOne("app_user_profiles", params.payload as never);
}

function buildProfileVisibilityPayload(
    input: AdminUpdateUserInput,
): JsonObject {
    const payload: JsonObject = {};
    if (input.profile_public !== undefined) {
        payload.profile_public = input.profile_public;
    }
    if (input.show_articles_on_profile !== undefined) {
        payload.show_articles_on_profile = input.show_articles_on_profile;
    }
    if (input.show_diaries_on_profile !== undefined) {
        payload.show_diaries_on_profile = input.show_diaries_on_profile;
    }
    if (input.show_bangumi_on_profile !== undefined) {
        payload.show_bangumi_on_profile = input.show_bangumi_on_profile;
    }
    if (input.show_albums_on_profile !== undefined) {
        payload.show_albums_on_profile = input.show_albums_on_profile;
    }
    if (input.show_comments_on_profile !== undefined) {
        payload.show_comments_on_profile = input.show_comments_on_profile;
    }
    return payload;
}

function buildProfilePayload(
    input: AdminUpdateUserInput,
    _body: JsonObject,
): JsonObject {
    const payload: JsonObject = {};
    if (input.display_name !== undefined) {
        payload.display_name = validateDisplayName(input.display_name);
    }
    if (input.social_links !== undefined) {
        payload.social_links = input.social_links;
    }
    if (input.bio_typewriter_enable !== undefined) {
        payload.bio_typewriter_enable = input.bio_typewriter_enable;
    }
    if (input.bio_typewriter_speed !== undefined) {
        payload.bio_typewriter_speed = input.bio_typewriter_speed;
    }
    return { ...payload, ...buildProfileVisibilityPayload(input) };
}

async function applyAvatarFileChange(
    body: JsonObject,
    userId: string,
    prevAvatarFile: string | null,
    nextAvatarFile: string | null,
    nextProfilePublic: boolean,
): Promise<void> {
    const hasAvatarPatch = hasOwn(body, "avatar_file");
    if (!hasAvatarPatch && !hasOwn(body, "profile_public")) {
        return;
    }
    if (nextAvatarFile) {
        await updateDirectusFileMetadata(nextAvatarFile, {
            uploaded_by: userId,
            app_owner_user_id: userId,
            app_visibility: nextProfilePublic ? "public" : "private",
        });
    }
    if (hasAvatarPatch && prevAvatarFile && prevAvatarFile !== nextAvatarFile) {
        await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [prevAvatarFile],
            ownerUserIds: [userId],
        });
    }
}

function extractSnapshot(
    user: AppUser,
    registry: Awaited<ReturnType<typeof loadDirectusAccessRegistry>>,
): DirectusUserSnapshot {
    const roleName = extractDirectusRoleName(user.role);
    const policyIds = extractDirectusPolicyIds(user.policies);
    const policyNames = resolvePolicyNames(policyIds, registry.policyNameById);
    return {
        roleName,
        policyIds,
        policyNames,
        isPlatformAdmin:
            isPlatformAdministratorRoleName(roleName) ||
            policyNames.includes(DIRECTUS_ROLE_NAME.administrator),
    };
}

function buildProfileView(profile: AppProfile, user: AppUser): AppProfileView {
    return toAppProfileView(profile, {
        avatar: user.avatar,
        description: user.description ?? null,
    });
}

function buildPermissionSnapshot(
    user: AppUser,
    registry: Awaited<ReturnType<typeof loadDirectusAccessRegistry>>,
): AppPermissions {
    const snapshot = extractSnapshot(user, registry);
    return buildPermissionsFromDirectus({
        roleName: snapshot.roleName,
        policyNames: snapshot.policyNames,
        isPlatformAdmin: snapshot.isPlatformAdmin,
    });
}

function mergePermissions(
    current: AppPermissions,
    patch: Partial<AppPermissions>,
): AppPermissions {
    return {
        app_role: patch.app_role ?? current.app_role,
        can_publish_articles:
            patch.can_publish_articles ?? current.can_publish_articles,
        can_comment_articles:
            patch.can_comment_articles ?? current.can_comment_articles,
        can_manage_diaries:
            patch.can_manage_diaries ?? current.can_manage_diaries,
        can_comment_diaries:
            patch.can_comment_diaries ?? current.can_comment_diaries,
        can_manage_albums: patch.can_manage_albums ?? current.can_manage_albums,
        can_upload_files: patch.can_upload_files ?? current.can_upload_files,
    };
}

function buildManagedPolicyIds(
    permissions: AppPermissions,
    registry: Awaited<ReturnType<typeof loadDirectusAccessRegistry>>,
): string[] {
    if (permissions.app_role === "admin") {
        const siteAdminPolicyId = registry.policyIdByName.get(
            DIRECTUS_POLICY_NAME.siteAdmin,
        );
        return siteAdminPolicyId ? [siteAdminPolicyId] : [];
    }
    const names: string[] = [];
    if (permissions.can_publish_articles) {
        names.push(DIRECTUS_POLICY_NAME.publishArticles);
    }
    if (permissions.can_comment_articles) {
        names.push(DIRECTUS_POLICY_NAME.commentArticles);
    }
    if (permissions.can_manage_diaries) {
        names.push(DIRECTUS_POLICY_NAME.manageDiaries);
    }
    if (permissions.can_comment_diaries) {
        names.push(DIRECTUS_POLICY_NAME.commentDiaries);
    }
    if (permissions.can_manage_albums) {
        names.push(DIRECTUS_POLICY_NAME.manageAlbums);
    }
    if (permissions.can_upload_files) {
        names.push(DIRECTUS_POLICY_NAME.uploadFiles);
    }
    return names
        .map((name) => registry.policyIdByName.get(name) || "")
        .filter(Boolean);
}

function mergePolicyIds(params: {
    currentPolicyIds: string[];
    desiredManagedPolicyIds: string[];
    registry: Awaited<ReturnType<typeof loadDirectusAccessRegistry>>;
}): string[] {
    const managedPolicyIds = new Set(
        MANAGED_POLICY_NAMES.map(
            (name) => params.registry.policyIdByName.get(name) || "",
        ).filter(Boolean),
    );
    const preserved = params.currentPolicyIds.filter(
        (policyId) => !managedPolicyIds.has(policyId),
    );
    return Array.from(
        new Set([...preserved, ...params.desiredManagedPolicyIds]),
    );
}

function assertEditableBySiteAdmin(params: {
    actingIsPlatformAdmin: boolean;
    targetIsPlatformAdmin: boolean;
}): void {
    if (!params.actingIsPlatformAdmin && params.targetIsPlatformAdmin) {
        throw forbidden(
            "PLATFORM_ADMIN_MANAGED_EXTERNALLY",
            "平台管理员只能在 Directus 后台中维护",
        );
    }
}

async function loadDirectusUserForAdmin(
    userId: string,
): Promise<AppUser | null> {
    return await readOneById("directus_users", userId, {
        fields: [
            "id",
            "email",
            "first_name",
            "last_name",
            "description",
            "avatar",
            "status",
            "role.id",
            "role.name",
            "policies.*",
        ],
    });
}

async function handleUsersList(context: APIContext): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url);
    const [users, registry] = await Promise.all([
        listDirectusUsers({
            limit,
            offset,
            search: context.url.searchParams.get("q") || undefined,
        }),
        loadDirectusAccessRegistry(),
    ]);
    const userIds = users.map((user) => user.id);
    const filterByIds =
        userIds.length > 0
            ? ({ user_id: { _in: userIds } } as JsonObject)
            : ({ id: { _null: true } } as JsonObject);
    const profiles = await readMany("app_user_profiles", {
        filter: filterByIds,
        limit: Math.max(userIds.length, DEFAULT_LIST_LIMIT),
    });

    const profileMap = new Map<string, AppProfile>();
    for (const profile of profiles) {
        profileMap.set(profile.user_id, profile);
    }

    const items: AdminUserRow[] = users.map((user) => {
        const snapshot = extractSnapshot(user, registry);
        const profile = profileMap.get(user.id) || null;
        return {
            user,
            profile: profile ? buildProfileView(profile, user) : null,
            permissions: buildPermissionsFromDirectus({
                roleName: snapshot.roleName,
                policyNames: snapshot.policyNames,
                isPlatformAdmin: snapshot.isPlatformAdmin,
            }),
            is_platform_admin: snapshot.isPlatformAdmin,
            is_site_admin: snapshot.roleName === DIRECTUS_ROLE_NAME.siteAdmin,
        };
    });

    return ok({
        items,
        page,
        limit,
        total: users.length,
    });
}

// eslint-disable-next-line complexity -- 需在一次请求内同步 Directus 角色/策略与站点档案
async function handleUserPatch(
    context: APIContext,
    userId: string,
    actingAdminUser: AppUser,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminUpdateUserSchema, body);
    const [targetUser, registry] = await Promise.all([
        loadDirectusUserForAdmin(userId),
        loadDirectusAccessRegistry(),
    ]);
    if (!targetUser) {
        return fail("用户不存在", 404);
    }

    const actingSnapshot = extractSnapshot(actingAdminUser, registry);
    const targetSnapshot = extractSnapshot(targetUser, registry);
    assertEditableBySiteAdmin({
        actingIsPlatformAdmin: actingSnapshot.isPlatformAdmin,
        targetIsPlatformAdmin: targetSnapshot.isPlatformAdmin,
    });

    const directusPayload: JsonObject = {};
    if (input.email !== undefined) {
        directusPayload.email = input.email;
    }
    if (input.first_name !== undefined) {
        directusPayload.first_name = input.first_name;
    }
    if (input.last_name !== undefined) {
        directusPayload.last_name = input.last_name;
    }
    if (input.password !== undefined) {
        directusPayload.password = input.password;
    }
    if (input.bio !== undefined) {
        directusPayload.description = parseProfileBioField(input.bio);
    }
    if (hasOwn(body as JsonObject, "avatar_file")) {
        directusPayload.avatar = input.avatar_file ?? null;
    }

    const currentPermissions = buildPermissionSnapshot(targetUser, registry);
    const mergedPermissions = mergePermissions(
        currentPermissions,
        extractPermissionPatch(input),
    );

    if (!targetSnapshot.isPlatformAdmin) {
        if (input.app_role !== undefined) {
            const nextRoleName =
                mergedPermissions.app_role === "admin"
                    ? DIRECTUS_ROLE_NAME.siteAdmin
                    : DIRECTUS_ROLE_NAME.member;
            const nextRoleId = registry.roleIdByName.get(nextRoleName);
            if (!nextRoleId) {
                throw badRequest(
                    "DIRECTUS_ROLE_MISSING",
                    `缺少 Directus 角色：${nextRoleName}`,
                );
            }
            directusPayload.role = nextRoleId;
        }

        const desiredManagedPolicyIds = buildManagedPolicyIds(
            mergedPermissions,
            registry,
        );
        const desiredPolicyIds = mergePolicyIds({
            currentPolicyIds: targetSnapshot.policyIds,
            desiredManagedPolicyIds,
            registry,
        });
        await syncDirectusUserPolicies({
            userId,
            currentAssignments: Array.isArray(targetUser.policies)
                ? targetUser.policies
                      .filter(
                          (entry): entry is { id?: string; policy?: string } =>
                              Boolean(entry && typeof entry === "object"),
                      )
                      .map((entry) => ({
                          id: String(entry.id ?? "").trim(),
                          policy: String(entry.policy ?? "").trim(),
                      }))
                : [],
            desiredPolicyIds,
        });
    }

    if (Object.keys(directusPayload).length > 0) {
        await updateDirectusUser(userId, directusPayload);
    }

    const profile = await ensureUserProfile(userId, input.username || "Member");
    const prevAvatarFile = normalizeDirectusFileId(targetUser.avatar);
    const nextAvatarFile = hasOwn(body as JsonObject, "avatar_file")
        ? normalizeDirectusFileId(input.avatar_file)
        : prevAvatarFile;
    const nextProfilePublic = input.profile_public ?? profile.profile_public;

    const profilePayload = buildProfilePayload(input, body as JsonObject);
    if (input.username !== undefined) {
        const normalized = normalizeRequestedUsername(input.username);
        await ensureUsernameAvailable(normalized, profile.id);
        profilePayload.username = normalized;
    }

    const updatedProfile =
        Object.keys(profilePayload).length > 0
            ? await updateOne("app_user_profiles", profile.id, profilePayload)
            : profile;

    invalidateAuthorCache(userId);
    void cacheManager.invalidateByDomain("profile-viewer");
    invalidateOfficialSidebarCache();
    invalidateDirectusAccessRegistry();
    await applyAvatarFileChange(
        body as JsonObject,
        userId,
        prevAvatarFile,
        nextAvatarFile,
        nextProfilePublic,
    );

    const refreshedUser =
        (await loadDirectusUserForAdmin(userId)) || targetUser;
    return ok({
        id: userId,
        user: refreshedUser,
        profile: buildProfileView(updatedProfile, refreshedUser),
        permissions: buildPermissionSnapshot(refreshedUser, registry),
        is_platform_admin: extractSnapshot(refreshedUser, registry)
            .isPlatformAdmin,
        is_site_admin:
            extractDirectusRoleName(refreshedUser.role) ===
            DIRECTUS_ROLE_NAME.siteAdmin,
    });
}

async function collectCandidateFileIds(userId: string): Promise<string[]> {
    try {
        return await collectUserOwnedFileIds(userId);
    } catch (error) {
        const message = String(error);
        if (/forbidden|permission/i.test(message)) {
            console.warn(
                "[admin/users] skip collectUserOwnedFileIds due to permission:",
                message,
            );
            return [];
        }
        throw error;
    }
}

async function handleUserDelete(
    userId: string,
    actingAdminUser: AppUser,
): Promise<Response> {
    if (actingAdminUser.id === userId) {
        throw badRequest("USER_DELETE_SELF_FORBIDDEN", "不能删除当前登录账号");
    }

    const [targetUser, registry] = await Promise.all([
        loadDirectusUserForAdmin(userId),
        loadDirectusAccessRegistry(),
    ]);
    if (!targetUser) {
        return fail("用户不存在", 404);
    }

    const actingSnapshot = extractSnapshot(actingAdminUser, registry);
    const targetSnapshot = extractSnapshot(targetUser, registry);
    assertEditableBySiteAdmin({
        actingIsPlatformAdmin: actingSnapshot.isPlatformAdmin,
        targetIsPlatformAdmin: targetSnapshot.isPlatformAdmin,
    });

    const candidateFileIds = await collectCandidateFileIds(userId);
    const referencedFileIds =
        await collectReferencedDirectusFileIds(candidateFileIds);
    const removableFileIds = candidateFileIds.filter(
        (fileId) => !referencedFileIds.has(fileId),
    );
    const referencedFilesPromise = loadReferencedFilesByUser(userId);

    const [profiles, registrationRequests, referencedFiles] = await Promise.all(
        [
            readMany("app_user_profiles", {
                filter: { user_id: { _eq: userId } } as JsonObject,
                limit: 10,
                fields: ["id"],
            }),
            readMany("app_user_registration_requests", {
                filter: {
                    _or: [
                        { approved_user_id: { _eq: userId } },
                        { pending_user_id: { _eq: userId } },
                    ],
                } as JsonObject,
                limit: 200,
                fields: ["id", "avatar_file"],
            }),
            referencedFilesPromise,
        ],
    );

    for (const profile of profiles) {
        await deleteOne("app_user_profiles", profile.id);
    }
    await nullifyRegistrationRequestAvatars(registrationRequests);
    await nullifyReferencedFileOwnership(
        referencedFiles.filter((file) => referencedFileIds.has(file.id)),
        userId,
    );
    await clearBlockingUserReferences(userId);
    await deleteDirectusUser(userId);
    await cleanupOwnedOrphanDirectusFiles({
        candidateFileIds: removableFileIds,
        ownerUserIds: [userId],
    });
    invalidateAuthorCache(userId);
    invalidateOfficialSidebarCache();
    invalidateDirectusAccessRegistry();
    return ok({ id: userId, deleted: true });
}

async function handleResetPassword(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }
    const userId = parseRouteId(segments[1]);
    if (!userId) {
        return fail("缺少用户 ID", 400);
    }
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminResetPasswordSchema, body);
    await updateDirectusUser(userId, {
        password: input.new_password,
    });
    return ok({ id: userId, reset: true });
}

export async function handleAdminUsers(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    const actingAdminUser = await loadDirectusUserForAdmin(
        required.access.user.id,
    );
    if (!actingAdminUser) {
        return fail("管理员用户不存在", 404);
    }
    return await runWithDirectusUserAccess(required.accessToken, async () => {
        if (segments.length === 1) {
            if (context.request.method === "GET") {
                return handleUsersList(context);
            }
            if (context.request.method === "POST") {
                return fail("接口不存在", 404, "LEGACY_ENDPOINT_DISABLED");
            }
        }

        if (segments.length === 2) {
            const userId = parseRouteId(segments[1]);
            if (!userId) {
                return fail("缺少用户 ID", 400);
            }
            if (context.request.method === "PATCH") {
                return handleUserPatch(context, userId, actingAdminUser);
            }
            if (context.request.method === "DELETE") {
                return handleUserDelete(userId, actingAdminUser);
            }
        }

        if (segments.length === 3 && segments[2] === "reset-password") {
            return handleResetPassword(context, segments);
        }

        return fail("未找到接口", 404);
    });
}
