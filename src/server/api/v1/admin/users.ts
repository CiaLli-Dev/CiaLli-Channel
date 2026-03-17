import type { APIContext } from "astro";

import type { AppPermissions, AppProfile } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { createUniqueUsername } from "@/server/auth/acl";
import {
    normalizeRequestedUsername,
    validateDisplayName,
} from "@/server/auth/username";
import {
    createOne,
    deleteDirectusUser,
    deleteOne,
    listDirectusUsers,
    readMany,
    updateDirectusFileMetadata,
    updateDirectusUser,
    updateManyItemsByFilter,
    updateOne,
} from "@/server/directus/client";
import { cacheManager } from "@/server/cache/manager";
import { badRequest } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import type { AdminUpdateUserInput } from "@/server/api/schemas";
import {
    AdminUpdateUserSchema,
    AdminResetPasswordSchema,
} from "@/server/api/schemas";
import { invalidateOfficialSidebarCache } from "../public-data";
import {
    cleanupOrphanDirectusFiles,
    collectUserOwnedFileIds,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";

import {
    DEFAULT_LIST_LIMIT,
    ensureUsernameAvailable,
    hasOwn,
    parseRouteId,
    requireAdmin,
} from "../shared";
import { invalidateAuthorCache } from "../shared/author-cache";

function extractPermissionPatch(input: AdminUpdateUserInput): JsonObject {
    const payload: JsonObject = {};
    if (input.app_role !== undefined) {
        payload.app_role = input.app_role;
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
    if (input.can_manage_anime !== undefined) {
        payload.can_manage_anime = input.can_manage_anime;
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
    const created = await createOne("app_user_profiles", {
        status: "published",
        user_id: userId,
        username: normalizedUsername,
        display_name: normalizedUsername,
        bio: null,
        bio_typewriter_enable: true,
        bio_typewriter_speed: 80,
        avatar_file: null,
        avatar_url: null,
        profile_public: true,
        show_articles_on_profile: true,
        show_diaries_on_profile: true,
        show_bangumi_on_profile: true,
        show_albums_on_profile: true,
        show_comments_on_profile: true,
    });
    invalidateAuthorCache(userId);
    return created;
}

async function ensureUserPermissions(userId: string): Promise<AppPermissions> {
    const rows = await readMany("app_user_permissions", {
        filter: { user_id: { _eq: userId } } as JsonObject,
        limit: 1,
    });
    if (rows[0]) {
        return rows[0];
    }

    return await createOne("app_user_permissions", {
        user_id: userId,
        app_role: "member",
        can_publish_articles: true,
        can_comment_articles: true,
        can_manage_diaries: true,
        can_comment_diaries: true,
        can_manage_anime: true,
        can_manage_albums: true,
        can_upload_files: true,
    });
}

const USER_DELETE_NULLIFY_REFERENCES: Array<{
    collection: string;
    field: string;
}> = [
    { collection: "directus_notifications", field: "sender" },
    { collection: "directus_versions", field: "user_updated" },
    { collection: "directus_comments", field: "user_updated" },
    { collection: "app_site_settings", field: "user_created" },
    { collection: "app_site_settings", field: "user_updated" },
    { collection: "app_diary_likes", field: "user_created" },
    { collection: "app_diary_likes", field: "user_updated" },
    { collection: "ai_prompts", field: "user_created" },
    { collection: "ai_prompts", field: "user_updated" },
];

async function nullifyUserReferenceField(
    collection: string,
    field: string,
    userId: string,
): Promise<void> {
    try {
        await updateManyItemsByFilter({
            collection,
            filter: { [field]: { _eq: userId } } as JsonObject,
            data: { [field]: null } as JsonObject,
        });
    } catch (error) {
        const message = String(error);
        if (
            message.includes("COLLECTION_NOT_FOUND") ||
            message.includes("ITEM_NOT_FOUND") ||
            message.includes("404")
        ) {
            return;
        }
        if (
            /forbidden|permission|readonly|read-only|invalid payload|field/i.test(
                message,
            )
        ) {
            console.warn(
                `[admin/users] skip nullify reference ${collection}.${field}:`,
                message,
            );
            return;
        }
        throw error;
    }
}

async function clearBlockingUserReferences(userId: string): Promise<void> {
    for (const target of USER_DELETE_NULLIFY_REFERENCES) {
        await nullifyUserReferenceField(
            target.collection,
            target.field,
            userId,
        );
    }
}

export async function handleAdminUsers(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    if (segments.length === 1) {
        if (context.request.method === "GET") {
            const { page, limit, offset } = parsePagination(context.url);
            const users = await listDirectusUsers({
                limit,
                offset,
                search: context.url.searchParams.get("q") || undefined,
            });
            const userIds = users.map((user) => user.id);
            const [profiles, permissions] = await Promise.all([
                readMany("app_user_profiles", {
                    filter:
                        userIds.length > 0
                            ? ({ user_id: { _in: userIds } } as JsonObject)
                            : ({ id: { _null: true } } as JsonObject),
                    limit: Math.max(userIds.length, DEFAULT_LIST_LIMIT),
                }),
                readMany("app_user_permissions", {
                    filter:
                        userIds.length > 0
                            ? ({ user_id: { _in: userIds } } as JsonObject)
                            : ({ id: { _null: true } } as JsonObject),
                    limit: Math.max(userIds.length, DEFAULT_LIST_LIMIT),
                }),
            ]);

            const profileMap = new Map<string, AppProfile>();
            for (const profile of profiles) {
                profileMap.set(profile.user_id, profile);
            }
            const permissionMap = new Map<string, AppPermissions>();
            for (const permission of permissions) {
                permissionMap.set(permission.user_id, permission);
            }

            return ok({
                items: users.map((user) => ({
                    user,
                    profile: profileMap.get(user.id) || null,
                    permissions: permissionMap.get(user.id) || null,
                })),
                page,
                limit,
                total: users.length,
            });
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
            const body = await parseJsonBody(context.request);
            const input = validateBody(AdminUpdateUserSchema, body);

            // ── Directus 用户字段 ──
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
            if (input.role !== undefined) {
                directusPayload.role = input.role;
            }
            if (input.password !== undefined) {
                directusPayload.password = input.password;
            }

            if (Object.keys(directusPayload).length > 0) {
                await updateDirectusUser(userId, directusPayload);
            }

            const profile = await ensureUserProfile(
                userId,
                input.username || "Member",
            );
            const permissions = await ensureUserPermissions(userId);
            const prevAvatarFile = normalizeDirectusFileId(profile.avatar_file);
            let nextAvatarFile = prevAvatarFile;

            // ── 档案字段 ──
            const profilePayload: JsonObject = {};
            if (input.username !== undefined) {
                const normalized = normalizeRequestedUsername(input.username);
                await ensureUsernameAvailable(normalized, profile.id);
                profilePayload.username = normalized;
            }
            if (input.display_name !== undefined) {
                profilePayload.display_name = validateDisplayName(
                    input.display_name,
                );
            }
            if (input.social_links !== undefined) {
                profilePayload.social_links = input.social_links;
            }
            if (input.bio !== undefined) {
                profilePayload.bio = input.bio;
            }
            if (input.bio_typewriter_enable !== undefined) {
                profilePayload.bio_typewriter_enable =
                    input.bio_typewriter_enable;
            }
            if (input.bio_typewriter_speed !== undefined) {
                profilePayload.bio_typewriter_speed =
                    input.bio_typewriter_speed;
            }
            if (hasOwn(body as JsonObject, "avatar_file")) {
                nextAvatarFile = normalizeDirectusFileId(input.avatar_file);
                profilePayload.avatar_file = input.avatar_file ?? null;
            }
            if (input.avatar_url !== undefined) {
                profilePayload.avatar_url = input.avatar_url;
            }
            if (input.profile_public !== undefined) {
                profilePayload.profile_public = input.profile_public;
            }
            if (input.show_articles_on_profile !== undefined) {
                profilePayload.show_articles_on_profile =
                    input.show_articles_on_profile;
            }
            if (input.show_diaries_on_profile !== undefined) {
                profilePayload.show_diaries_on_profile =
                    input.show_diaries_on_profile;
            }
            if (input.show_bangumi_on_profile !== undefined) {
                profilePayload.show_bangumi_on_profile =
                    input.show_bangumi_on_profile;
            }
            if (input.show_albums_on_profile !== undefined) {
                profilePayload.show_albums_on_profile =
                    input.show_albums_on_profile;
            }
            if (input.show_comments_on_profile !== undefined) {
                profilePayload.show_comments_on_profile =
                    input.show_comments_on_profile;
            }

            // ── 权限字段 ──
            const permissionsPayload = extractPermissionPatch(input);
            const [updatedProfile, updatedPermissions] = await Promise.all([
                Object.keys(profilePayload).length > 0
                    ? updateOne("app_user_profiles", profile.id, profilePayload)
                    : Promise.resolve(profile),
                Object.keys(permissionsPayload).length > 0
                    ? updateOne(
                          "app_user_permissions",
                          permissions.id,
                          permissionsPayload,
                      )
                    : Promise.resolve(permissions),
            ]);

            invalidateAuthorCache(userId);
            void cacheManager.invalidateByDomain("profile-viewer");
            invalidateOfficialSidebarCache();
            if (hasOwn(body as JsonObject, "avatar_file") && nextAvatarFile) {
                await updateDirectusFileMetadata(nextAvatarFile, {
                    uploaded_by: userId,
                });
            }
            if (
                hasOwn(body as JsonObject, "avatar_file") &&
                prevAvatarFile &&
                prevAvatarFile !== nextAvatarFile
            ) {
                await cleanupOrphanDirectusFiles([prevAvatarFile]);
            }
            return ok({
                id: userId,
                profile: updatedProfile,
                permissions: updatedPermissions,
            });
        }

        if (context.request.method === "DELETE") {
            if (required.access.user.id === userId) {
                throw badRequest(
                    "USER_DELETE_SELF_FORBIDDEN",
                    "不能删除当前登录账号",
                );
            }
            let candidateFileIds: string[] = [];
            try {
                candidateFileIds = await collectUserOwnedFileIds(userId);
            } catch (error) {
                const message = String(error);
                if (/forbidden|permission/i.test(message)) {
                    console.warn(
                        "[admin/users] skip collectUserOwnedFileIds due to permission:",
                        message,
                    );
                } else {
                    throw error;
                }
            }

            const referencedFilesPromise = readMany("directus_files", {
                filter: {
                    _or: [
                        { uploaded_by: { _eq: userId } },
                        { modified_by: { _eq: userId } },
                    ],
                } as JsonObject,
                limit: 5000,
                fields: ["id", "uploaded_by", "modified_by"],
            }).catch((error) => {
                const message = String(error);
                if (/forbidden|permission/i.test(message)) {
                    console.warn(
                        "[admin/users] skip read referenced directus_files due to permission:",
                        message,
                    );
                    return [];
                }
                throw error;
            });

            const [
                profiles,
                permissions,
                registrationRequests,
                referencedFiles,
            ] = await Promise.all([
                readMany("app_user_profiles", {
                    filter: { user_id: { _eq: userId } } as JsonObject,
                    limit: 10,
                    fields: ["id"],
                }),
                readMany("app_user_permissions", {
                    filter: { user_id: { _eq: userId } } as JsonObject,
                    limit: 10,
                    fields: ["id"],
                }),
                readMany("app_user_registration_requests", {
                    filter: {
                        approved_user_id: { _eq: userId },
                    } as JsonObject,
                    limit: 200,
                    fields: ["id", "avatar_file"],
                }),
                referencedFilesPromise,
            ]);

            for (const profile of profiles) {
                await deleteOne("app_user_profiles", profile.id);
            }
            for (const permission of permissions) {
                await deleteOne("app_user_permissions", permission.id);
            }
            for (const request of registrationRequests) {
                if (!request.avatar_file) {
                    continue;
                }
                await updateOne("app_user_registration_requests", request.id, {
                    avatar_file: null,
                });
            }
            for (const file of referencedFiles) {
                const payload: {
                    uploaded_by?: null;
                    modified_by?: null;
                } = {};
                if (String(file.uploaded_by || "").trim() === userId) {
                    payload.uploaded_by = null;
                }
                if (String(file.modified_by || "").trim() === userId) {
                    payload.modified_by = null;
                }
                if (Object.keys(payload).length === 0) {
                    continue;
                }
                try {
                    await updateDirectusFileMetadata(file.id, payload);
                } catch (error) {
                    const message = String(error);
                    if (
                        payload.uploaded_by === null &&
                        payload.modified_by === null
                    ) {
                        try {
                            await updateDirectusFileMetadata(file.id, {
                                uploaded_by: null,
                            });
                            continue;
                        } catch (fallbackError) {
                            console.warn(
                                `[admin/users] skip file cleanup ${file.id}:`,
                                String(fallbackError),
                            );
                            continue;
                        }
                    }
                    console.warn(
                        `[admin/users] skip file cleanup ${file.id}:`,
                        message,
                    );
                }
            }
            await clearBlockingUserReferences(userId);

            await deleteDirectusUser(userId);
            await cleanupOrphanDirectusFiles(candidateFileIds);
            invalidateAuthorCache(userId);
            invalidateOfficialSidebarCache();
            return ok({ id: userId, deleted: true });
        }
    }

    if (segments.length === 3 && segments[2] === "reset-password") {
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

    return fail("未找到接口", 404);
}
