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
    listDirectusUserPolicyAssignments,
    listDirectusUsers,
    readMany,
    readOneById,
    syncDirectusUserPolicies,
    updateDirectusUser,
    createOne,
    updateOne,
    type DirectusUserPolicyAssignment,
} from "@/server/directus/client";
import { cacheManager } from "@/server/cache/manager";
import { badRequest, forbidden } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import {
    withServiceRepositoryContext,
    withUserRepositoryContext,
} from "@/server/repositories/directus/scope";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import type { AdminUpdateUserInput } from "@/server/api/schemas";
import {
    AdminResetPasswordSchema,
    AdminUpdateUserSchema,
} from "@/server/api/schemas";
import { invalidateOfficialSidebarCache } from "@/server/api/v1/public-data";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup";

import { requireAdmin } from "@/server/api/v1/shared/auth";
import { DEFAULT_LIST_LIMIT } from "@/server/api/v1/shared/constants";
import { hasOwn } from "@/server/api/v1/shared/helpers";
import { ensureUsernameAvailable } from "@/server/api/v1/shared/loaders";
import { normalizeAppRole } from "@/server/api/v1/shared/normalize";
import {
    parseProfileBioField,
    parseRouteId,
} from "@/server/api/v1/shared/parse";
import { invalidateAuthorCache } from "@/server/api/v1/shared/author-cache";
import {
    bindFileOwnerToUser,
    syncManagedFileBinding,
} from "@/server/api/v1/me/_helpers";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";
import { searchIndex } from "@/server/application/shared/search-index";
import {
    clearBlockingUserReferences,
    loadReferencedFilesByUser,
    nullifyReferencedFileOwnership,
    nullifyRegistrationRequestAvatars,
} from "@/server/api/v1/admin/users-helpers";

const MANAGED_POLICY_NAMES = [
    DIRECTUS_POLICY_NAME.publishArticles,
    DIRECTUS_POLICY_NAME.commentArticles,
    DIRECTUS_POLICY_NAME.manageDiaries,
    DIRECTUS_POLICY_NAME.commentDiaries,
    DIRECTUS_POLICY_NAME.manageAlbums,
    DIRECTUS_POLICY_NAME.uploadFiles,
] as const;

function isInternalServiceAccountEmail(email: unknown): boolean {
    const normalizedEmail = String(email || "")
        .trim()
        .toLowerCase();
    return (
        normalizedEmail.startsWith("svc-web-") ||
        normalizedEmail.startsWith("svc-worker-")
    );
}

function isInternalServiceUser(user: AppUser | null | undefined): boolean {
    return Boolean(user && isInternalServiceAccountEmail(user.email));
}

function isVisibleManagedUser(user: AppUser): boolean {
    if (isInternalServiceUser(user)) {
        return false;
    }
    return String(user.status || "").trim() !== "draft";
}

type AdminUserRow = {
    user: AppUser;
    profile: AppProfileView | null;
    permissions: AppPermissions;
    is_platform_admin: boolean;
    is_site_admin: boolean;
};

type AdminUsersSortBy = "email" | "username" | "role";
type AdminUsersSortOrder = "asc" | "desc";

type DirectusUserSnapshot = {
    roleName: string | null;
    policyIds: string[];
    policyNames: string[];
    isPlatformAdmin: boolean;
};

const ADMIN_USERS_SORT_BY_DEFAULT: AdminUsersSortBy = "email";

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
    if (hasAvatarPatch) {
        await syncManagedFileBinding({
            previousFileValue: prevAvatarFile,
            nextFileValue: nextAvatarFile,
            userId,
            visibility: nextProfilePublic ? "public" : "private",
            reference: {
                ownerCollection: "directus_users",
                ownerId: userId,
                ownerField: "avatar",
                referenceKind: "structured_field",
            },
        });
        return;
    }
    if (nextAvatarFile) {
        await bindFileOwnerToUser(
            nextAvatarFile,
            userId,
            undefined,
            nextProfilePublic ? "public" : "private",
            {
                ownerCollection: "directus_users",
                ownerId: userId,
                ownerField: "avatar",
                referenceKind: "structured_field",
            },
        );
    }
}

function extractSnapshot(
    user: AppUser,
    registry: Awaited<ReturnType<typeof loadDirectusAccessRegistry>>,
    accessAssignments: readonly DirectusUserPolicyAssignment[] = [],
): DirectusUserSnapshot {
    const roleName = extractDirectusRoleName(user.role);
    const policyIds = Array.from(
        new Set([
            ...extractDirectusPolicyIds(user.policies),
            ...accessAssignments.map((assignment) =>
                String(assignment.policy || "").trim(),
            ),
        ]),
    ).filter(Boolean);
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
    accessAssignments: readonly DirectusUserPolicyAssignment[] = [],
): AppPermissions {
    const snapshot = extractSnapshot(user, registry, accessAssignments);
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

function normalizeAdminUsersSortBy(value: string): AdminUsersSortBy {
    const normalized = value.trim().toLowerCase();
    if (normalized === "email") {
        return "email";
    }
    if (normalized === "username") {
        return "username";
    }
    if (normalized === "role") {
        return "role";
    }
    return ADMIN_USERS_SORT_BY_DEFAULT;
}

function normalizeAdminUsersSortOrder(value: string): AdminUsersSortOrder {
    return value.trim().toLowerCase() === "desc" ? "desc" : "asc";
}

function normalizeSortText(value: string | null | undefined): string {
    return String(value || "")
        .trim()
        .toLocaleLowerCase();
}

type SortTextValue = {
    value: string;
    missing: boolean;
};

function toSortTextValue(value: string | null | undefined): SortTextValue {
    const normalizedValue = normalizeSortText(value);
    return {
        value: normalizedValue,
        missing: normalizedValue.length === 0,
    };
}

function compareSortTextValue(
    left: SortTextValue,
    right: SortTextValue,
    order: AdminUsersSortOrder,
): number {
    if (left.missing && right.missing) {
        return 0;
    }
    if (left.missing) {
        return 1;
    }
    if (right.missing) {
        return -1;
    }
    if (left.value === right.value) {
        return 0;
    }
    const compareResult = left.value.localeCompare(right.value);
    return order === "desc" ? -compareResult : compareResult;
}

function compareSortText(
    left: string | null | undefined,
    right: string | null | undefined,
    order: AdminUsersSortOrder,
): number {
    return compareSortTextValue(
        toSortTextValue(left),
        toSortTextValue(right),
        order,
    );
}

function getUserRoleSortRank(row: AdminUserRow): number {
    if (row.is_platform_admin) {
        return 0;
    }
    if (row.permissions.app_role === "admin" || row.is_site_admin) {
        return 1;
    }
    return 2;
}

function applyAdminUsersSort(params: {
    items: AdminUserRow[];
    sortBy: AdminUsersSortBy;
    sortOrder: AdminUsersSortOrder;
}): AdminUserRow[] {
    if (params.sortBy === "email") {
        return params.items;
    }

    const indexedRows = params.items.map((item, index) => ({
        item,
        index,
    }));
    indexedRows.sort((left, right) => {
        if (params.sortBy === "username") {
            const leftUsernameValue = toSortTextValue(
                left.item.profile?.username,
            );
            const rightUsernameValue = toSortTextValue(
                right.item.profile?.username,
            );
            if (leftUsernameValue.missing && rightUsernameValue.missing) {
                return left.index - right.index;
            }
            const usernameDiff = compareSortTextValue(
                leftUsernameValue,
                rightUsernameValue,
                params.sortOrder,
            );
            if (usernameDiff !== 0) {
                return usernameDiff;
            }
            const emailDiff = compareSortText(
                left.item.user.email,
                right.item.user.email,
                "asc",
            );
            if (emailDiff !== 0) {
                return emailDiff;
            }
            return left.index - right.index;
        }

        const leftRoleRank = getUserRoleSortRank(left.item);
        const rightRoleRank = getUserRoleSortRank(right.item);
        if (leftRoleRank !== rightRoleRank) {
            return params.sortOrder === "desc"
                ? rightRoleRank - leftRoleRank
                : leftRoleRank - rightRoleRank;
        }
        const usernameDiff = compareSortText(
            left.item.profile?.username,
            right.item.profile?.username,
            "asc",
        );
        if (usernameDiff !== 0) {
            return usernameDiff;
        }
        const emailDiff = compareSortText(
            left.item.user.email,
            right.item.user.email,
            "asc",
        );
        if (emailDiff !== 0) {
            return emailDiff;
        }
        return left.index - right.index;
    });
    return indexedRows.map((entry) => entry.item);
}

async function handleUsersList(context: APIContext): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url, {
        maxLimit: 200,
    });
    const sortBy = normalizeAdminUsersSortBy(
        context.url.searchParams.get("sort_by") || "",
    );
    const sortOrder = normalizeAdminUsersSortOrder(
        context.url.searchParams.get("sort_order") || "",
    );
    const [users, registry] = await Promise.all([
        listDirectusUsers({
            limit,
            offset,
            search: context.url.searchParams.get("q") || undefined,
            sort:
                sortBy === "email"
                    ? {
                          field: "email",
                          order: sortOrder,
                      }
                    : undefined,
        }),
        loadDirectusAccessRegistry(),
    ]);
    const visibleUsers = users.filter(isVisibleManagedUser);
    const userIds = visibleUsers.map((user) => user.id);
    const accessAssignmentsByUser =
        await listDirectusUserPolicyAssignments(userIds);
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

    const items = applyAdminUsersSort({
        items: visibleUsers.map((user) => {
            const snapshot = extractSnapshot(
                user,
                registry,
                accessAssignmentsByUser.get(user.id),
            );
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
                is_site_admin:
                    snapshot.roleName === DIRECTUS_ROLE_NAME.siteAdmin,
            };
        }),
        sortBy,
        sortOrder,
    });

    return ok({
        items,
        page,
        limit,
        total: visibleUsers.length,
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

    const accessAssignmentsByUser = await listDirectusUserPolicyAssignments([
        actingAdminUser.id,
        targetUser.id,
    ]);
    const actingSnapshot = extractSnapshot(
        actingAdminUser,
        registry,
        accessAssignmentsByUser.get(actingAdminUser.id),
    );
    const targetAssignments = accessAssignmentsByUser.get(targetUser.id) ?? [];
    const targetSnapshot = extractSnapshot(
        targetUser,
        registry,
        targetAssignments,
    );
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

    const currentPermissions = buildPermissionSnapshot(
        targetUser,
        registry,
        targetAssignments,
    );
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
            currentAssignments: targetAssignments,
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
    const refreshedAssignmentsByUser = await listDirectusUserPolicyAssignments([
        userId,
    ]);
    const refreshedSnapshot = extractSnapshot(
        refreshedUser,
        registry,
        refreshedAssignmentsByUser.get(userId),
    );
    return ok({
        id: userId,
        user: refreshedUser,
        profile: buildProfileView(updatedProfile, refreshedUser),
        permissions: buildPermissionsFromDirectus({
            roleName: refreshedSnapshot.roleName,
            policyNames: refreshedSnapshot.policyNames,
            isPlatformAdmin: refreshedSnapshot.isPlatformAdmin,
        }),
        is_platform_admin: refreshedSnapshot.isPlatformAdmin,
        is_site_admin:
            extractDirectusRoleName(refreshedUser.role) ===
            DIRECTUS_ROLE_NAME.siteAdmin,
    });
}

async function handleUserDelete(
    userId: string,
    actingAdminUser: AppUser,
): Promise<Response> {
    if (actingAdminUser.id === userId) {
        throw badRequest("USER_DELETE_SELF_FORBIDDEN", "不能删除当前登录账号");
    }

    return await withServiceRepositoryContext(async () => {
        const [targetUser, registry] = await Promise.all([
            loadDirectusUserForAdmin(userId),
            loadDirectusAccessRegistry(),
        ]);
        if (!targetUser) {
            return fail("用户不存在", 404);
        }
        if (isInternalServiceUser(targetUser)) {
            return fail(
                "服务账号由安装器和部署环境维护，不能在用户管理中删除",
                403,
                "SERVICE_ACCOUNT_MANAGED_EXTERNALLY",
            );
        }

        const actingSnapshot = extractSnapshot(actingAdminUser, registry);
        const targetSnapshot = extractSnapshot(targetUser, registry);
        assertEditableBySiteAdmin({
            actingIsPlatformAdmin: actingSnapshot.isPlatformAdmin,
            targetIsPlatformAdmin: targetSnapshot.isPlatformAdmin,
        });

        const [profiles, registrationRequests, remainingFiles] =
            await Promise.all([
                readMany("app_user_profiles", {
                    filter: { user_id: { _eq: userId } } as JsonObject,
                    limit: 10,
                    fields: ["id", "header_file"],
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
                loadReferencedFilesByUser(userId),
            ]);

        await clearBlockingUserReferences(userId);
        await nullifyReferencedFileOwnership(remainingFiles, userId);
        await deleteDirectusUser(userId);

        for (const profile of profiles) {
            await resourceLifecycle.releaseOwnerResources({
                ownerCollection: "app_user_profiles",
                ownerId: profile.id,
            });
        }
        for (const request of registrationRequests) {
            await syncManagedFileBinding({
                previousFileValue: request.avatar_file,
                nextFileValue: null,
                userId: null,
                visibility: "private",
                reference: {
                    ownerCollection: "app_user_registration_requests",
                    ownerId: request.id,
                    ownerField: "avatar_file",
                    referenceKind: "structured_field",
                },
            });
        }
        await nullifyRegistrationRequestAvatars(registrationRequests).catch(
            (error) => {
                console.warn(
                    "[admin/users] 清空注册请求头像引用失败, userId:",
                    userId,
                    error,
                );
            },
        );
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "directus_users",
            ownerId: userId,
        });
        await searchIndex.remove("user", userId);
        console.info("[audit] user.delete", {
            userId,
            profileCount: profiles.length,
            registrationRequestCount: registrationRequests.length,
        });
        invalidateAuthorCache(userId);
        invalidateOfficialSidebarCache();
        invalidateDirectusAccessRegistry();
        return ok({ id: userId, deleted: true });
    });
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

    const actingAdminUser = await withServiceRepositoryContext(async () =>
        loadDirectusUserForAdmin(required.access.user.id),
    );
    if (!actingAdminUser) {
        return fail("管理员用户不存在", 404);
    }

    if (segments.length === 2 && context.request.method === "DELETE") {
        const userId = parseRouteId(segments[1]);
        if (!userId) {
            return fail("缺少用户 ID", 400);
        }
        return handleUserDelete(userId, actingAdminUser);
    }

    return await withUserRepositoryContext(required.accessToken, async () => {
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
        }

        if (segments.length === 3 && segments[2] === "reset-password") {
            return handleResetPassword(context, segments);
        }

        return fail("未找到接口", 404);
    });
}
