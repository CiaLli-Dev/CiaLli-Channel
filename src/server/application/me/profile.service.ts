import type { APIContext } from "astro";

import type {
    AppFile,
    AppFileLifecycle,
    AppProfile,
    AppProfileView,
} from "@/types/app";
import type { JsonObject } from "@/types/json";
import { updateProfileUsername } from "@/server/auth/acl";
import {
    getSessionAccessToken,
    invalidateSessionUserCache,
} from "@/server/auth/session";
import { validateDisplayName } from "@/server/auth/username";
import { encryptBangumiAccessToken } from "@/server/bangumi/token";
import { normalizeBangumiId } from "@/server/bangumi/username";
import { toAppProfileView } from "@/server/profile-view";
import {
    readOneById,
    updateDirectusUser,
    updateOne,
} from "@/server/directus/client";
import { AppError } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import {
    UpdateProfileSchema,
    type UpdateProfileInput,
} from "@/server/api/schemas";
import { hasOwn } from "@/server/api/v1/shared/helpers";
import { parseProfileBioField } from "@/server/api/v1/shared/parse";
import type { AppAccess } from "@/server/api/v1/shared/types";
import { invalidateAuthorCache } from "@/server/api/v1/shared/author-cache";
import { invalidateOfficialSidebarCache } from "@/server/api/v1/public-data";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup";
import {
    bindFileOwnerToUser,
    syncManagedFileBinding,
} from "@/server/api/v1/me/_helpers";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";

type ProfileInput = UpdateProfileInput;

type AvatarPatch = {
    hasPatch: boolean;
    nextFile: string | null;
};

type DirectusUserProfileFields = {
    id: string;
    avatar: string | null;
    description: string | null;
};

type AvatarFileRecord = Pick<
    AppFile,
    | "id"
    | "app_lifecycle"
    | "app_owner_user_id"
    | "app_upload_purpose"
    | "uploaded_by"
>;

const BLOCKED_AVATAR_FILE_LIFECYCLES = new Set<AppFileLifecycle>([
    "detached",
    "quarantined",
    "deleting",
    "deleted",
    "delete_failed",
]);

function toProfileResponse(profile: AppProfileView): JsonObject {
    const { bangumi_access_token_encrypted, ...safeProfile } = profile;
    return {
        ...safeProfile,
        bangumi_access_token_set: Boolean(bangumi_access_token_encrypted),
    };
}

function buildHomeSectionOrder(
    order: string[] | null | undefined,
): string[] | null {
    const validSections = new Set(["articles", "diaries", "bangumi", "albums"]);
    if (order === null || order === undefined) {
        return null;
    }
    const deduped = [
        ...new Set(order.filter((item) => validSections.has(item))),
    ];
    for (const section of validSections) {
        if (!deduped.includes(section)) {
            deduped.push(section);
        }
    }
    return deduped;
}

function applyBasicFields(
    body: JsonObject,
    input: ProfileInput,
    payload: JsonObject,
): void {
    if (hasOwn(body, "header_file")) {
        payload.header_file = input.header_file ?? null;
    }
    if (input.profile_public !== undefined) {
        payload.profile_public = input.profile_public;
    }
    if (input.social_links !== undefined) {
        payload.social_links = input.social_links;
    }
}

function applyBangumiFields(
    body: JsonObject,
    input: ProfileInput,
    payload: JsonObject,
): void {
    if (input.show_bangumi_on_profile !== undefined) {
        payload.show_bangumi_on_profile = input.show_bangumi_on_profile;
    }
    if (input.bangumi_username !== undefined) {
        const normalizedBangumiId = normalizeBangumiId(input.bangumi_username);
        payload.bangumi_username = normalizedBangumiId || null;
    }
    if (input.bangumi_include_private !== undefined) {
        payload.bangumi_include_private = input.bangumi_include_private;
    }
    if (hasOwn(body, "bangumi_access_token")) {
        const token = String(input.bangumi_access_token || "").trim();
        payload.bangumi_access_token_encrypted = token
            ? encryptBangumiAccessToken(token)
            : null;
    }
    if (hasOwn(body, "home_section_order")) {
        payload.home_section_order = buildHomeSectionOrder(
            input.home_section_order,
        );
    }
}

function buildProfilePatchPayload(
    body: JsonObject,
    input: ProfileInput,
): JsonObject {
    const payload: JsonObject = {};
    applyBasicFields(body, input, payload);
    applyBangumiFields(body, input, payload);
    return payload;
}

function buildDirectusUserPatchPayload(
    input: ProfileInput,
    avatarPatch: AvatarPatch,
): JsonObject {
    const payload: JsonObject = {};
    if (input.bio !== undefined) {
        payload.description = parseProfileBioField(input.bio);
    }
    if (avatarPatch.hasPatch) {
        payload.avatar = avatarPatch.nextFile;
    }
    return payload;
}

function normalizeOwnerUserId(value: unknown): string | null {
    if (typeof value === "string") {
        return value.trim() || null;
    }
    if (value && typeof value === "object") {
        return normalizeOwnerUserId((value as { id?: unknown }).id);
    }
    return null;
}

function toAvatarFileInvalidError(): AppError {
    return new AppError("AVATAR_FILE_INVALID", "头像文件不存在或不可用", 400);
}

function isOwnedByUser(file: AvatarFileRecord, userId: string): boolean {
    const ownerIds = [
        normalizeOwnerUserId(file.app_owner_user_id),
        normalizeOwnerUserId(file.uploaded_by),
    ];
    return ownerIds.includes(userId);
}

async function loadAvatarFile(
    fileId: string,
): Promise<AvatarFileRecord | null> {
    return await withServiceRepositoryContext(async () => {
        const file = await readOneById("directus_files", fileId, {
            fields: [
                "id",
                "app_lifecycle",
                "app_owner_user_id",
                "app_upload_purpose",
                "uploaded_by",
            ],
        });
        return (file as AvatarFileRecord | null) ?? null;
    });
}

async function validateAvatarFileForPatch(
    body: JsonObject,
    input: ProfileInput,
    userId: string,
): Promise<AvatarPatch> {
    if (!hasOwn(body, "avatar_file")) {
        return { hasPatch: false, nextFile: null };
    }
    if (input.avatar_file === null || input.avatar_file === undefined) {
        return { hasPatch: true, nextFile: null };
    }

    const nextFile = normalizeDirectusFileId(input.avatar_file);
    if (!nextFile) {
        throw toAvatarFileInvalidError();
    }

    const file = await loadAvatarFile(nextFile);
    if (
        !file ||
        file.app_upload_purpose !== "avatar" ||
        !isOwnedByUser(file, userId) ||
        (file.app_lifecycle !== null &&
            file.app_lifecycle !== undefined &&
            BLOCKED_AVATAR_FILE_LIFECYCLES.has(file.app_lifecycle))
    ) {
        throw toAvatarFileInvalidError();
    }

    return { hasPatch: true, nextFile };
}

async function updateDirectusUserWithServiceAccess(
    userId: string,
    payload: JsonObject,
): Promise<void> {
    await withServiceRepositoryContext(async () => {
        await updateDirectusUser(userId, payload);
    });
}

async function loadDirectusUserProfileFields(
    userId: string,
): Promise<DirectusUserProfileFields> {
    const user = await withServiceRepositoryContext(async () =>
        readOneById("directus_users", userId, {
            fields: ["id", "description", "avatar"],
        }),
    );
    const id = String(user?.id ?? "").trim();
    if (!id) {
        throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
    }
    return {
        id,
        avatar: normalizeDirectusFileId(user?.avatar),
        description:
            typeof user?.description === "string" ? user.description : null,
    };
}

function assertAvatarPersisted(params: {
    avatarPatch: AvatarPatch;
    persistedAvatar: string | null;
}): void {
    if (!params.avatarPatch.hasPatch) {
        return;
    }
    if (params.persistedAvatar !== params.avatarPatch.nextFile) {
        throw new AppError(
            "AVATAR_SAVE_FAILED",
            "头像保存失败，请稍后重试",
            500,
        );
    }
}

async function rollbackAvatarPatch(params: {
    userId: string;
    previousAvatarFile: string | null;
}): Promise<void> {
    try {
        await updateDirectusUserWithServiceAccess(params.userId, {
            avatar: params.previousAvatarFile,
        });
    } catch (error) {
        console.error("[me/profile] rollback avatar failed", {
            userId: params.userId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function toAvatarSaveFailedError(error: unknown): AppError {
    if (error instanceof AppError && error.code === "AVATAR_SAVE_FAILED") {
        return error;
    }
    return new AppError("AVATAR_SAVE_FAILED", "头像保存失败，请稍后重试", 500);
}

async function applyAvatarFileBindings(
    avatarPatch: AvatarPatch,
    nextProfilePublic: boolean,
    access: AppAccess,
    prevAvatarFile: string | null,
): Promise<void> {
    if (avatarPatch.hasPatch) {
        await syncManagedFileBinding({
            previousFileValue: prevAvatarFile,
            nextFileValue: avatarPatch.nextFile,
            userId: access.user.id,
            visibility: nextProfilePublic ? "public" : "private",
            reference: {
                ownerCollection: "directus_users",
                ownerId: access.user.id,
                ownerField: "avatar",
                referenceKind: "structured_field",
            },
            strict: true,
        });
    }
}

async function applyHeaderFileBindings(
    body: JsonObject,
    input: ProfileInput,
    profileId: string,
    userId: string,
    prevHeaderFile: string | null,
    currentProfilePublic: boolean,
): Promise<void> {
    const hasHeaderFilePatch = hasOwn(body, "header_file");
    const nextHeaderFile = hasHeaderFilePatch
        ? (input.header_file ?? null)
        : prevHeaderFile;
    const nextProfilePublic = input.profile_public ?? currentProfilePublic;

    if (hasHeaderFilePatch) {
        await syncManagedFileBinding({
            previousFileValue: prevHeaderFile,
            nextFileValue: nextHeaderFile,
            userId,
            visibility: nextProfilePublic ? "public" : "private",
            reference: {
                ownerCollection: "app_user_profiles",
                ownerId: profileId,
                ownerField: "header_file",
                referenceKind: "structured_field",
            },
        });
    }
}

async function applyFileBindingsAndCleanup(
    body: JsonObject,
    input: ProfileInput,
    avatarPatch: AvatarPatch,
    access: AppAccess,
    prevAvatarFile: string | null,
    prevHeaderFile: string | null,
): Promise<void> {
    const nextProfilePublic =
        input.profile_public ?? access.profile.profile_public;
    await applyAvatarFileBindings(
        avatarPatch,
        nextProfilePublic,
        access,
        prevAvatarFile,
    );
    await applyHeaderFileBindings(
        body,
        input,
        access.profile.id,
        access.user.id,
        prevHeaderFile,
        access.profile.profile_public,
    );
    if (input.profile_public !== undefined) {
        const visibility = input.profile_public ? "public" : "private";
        if (prevAvatarFile && !hasOwn(body, "avatar_file")) {
            await bindFileOwnerToUser(
                prevAvatarFile,
                access.user.id,
                undefined,
                visibility,
                {
                    ownerCollection: "directus_users",
                    ownerId: access.user.id,
                    ownerField: "avatar",
                    referenceKind: "structured_field",
                },
            );
        }
        if (prevHeaderFile && !hasOwn(body, "header_file")) {
            await bindFileOwnerToUser(
                prevHeaderFile,
                access.user.id,
                undefined,
                visibility,
                {
                    ownerCollection: "app_user_profiles",
                    ownerId: access.profile.id,
                    ownerField: "header_file",
                    referenceKind: "structured_field",
                },
            );
        }
    }
}

function buildUpdatedProfileView(params: {
    updatedProfile: AppProfile;
    directusUser: DirectusUserProfileFields;
}): AppProfileView {
    const { updatedProfile, directusUser } = params;
    return toAppProfileView(updatedProfile, {
        avatar: directusUser.avatar,
        description: directusUser.description,
    });
}

async function getMyProfile(access: AppAccess): Promise<Response> {
    return ok({
        profile: toProfileResponse(access.profile),
    });
}

async function patchMyProfile(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateProfileSchema, body);
    const avatarPatch = await validateAvatarFileForPatch(
        body,
        input,
        access.user.id,
    );
    const profilePayload = buildProfilePatchPayload(body, input);
    const directusUserPayload = buildDirectusUserPatchPayload(
        input,
        avatarPatch,
    );

    if (input.username !== undefined) {
        const normalized = await updateProfileUsername(
            access.profile.id,
            input.username,
        );
        profilePayload.username = normalized;
    }
    if (input.display_name !== undefined) {
        profilePayload.display_name = validateDisplayName(input.display_name);
    }

    const prevAvatarFile = normalizeDirectusFileId(access.profile.avatar_file);
    const prevHeaderFile = access.profile.header_file;
    let directusUser: DirectusUserProfileFields = {
        id: access.user.id,
        avatar: prevAvatarFile,
        description: access.profile.bio,
    };
    const currentProfile: AppProfile = {
        id: access.profile.id,
        user_id: access.profile.user_id,
        username: access.profile.username,
        display_name: access.profile.display_name,
        header_file: access.profile.header_file,
        profile_public: access.profile.profile_public,
        show_articles_on_profile: access.profile.show_articles_on_profile,
        show_diaries_on_profile: access.profile.show_diaries_on_profile,
        show_bangumi_on_profile: access.profile.show_bangumi_on_profile,
        show_albums_on_profile: access.profile.show_albums_on_profile,
        show_comments_on_profile: access.profile.show_comments_on_profile,
        bangumi_username: access.profile.bangumi_username,
        bangumi_include_private: access.profile.bangumi_include_private,
        bangumi_access_token_encrypted:
            access.profile.bangumi_access_token_encrypted,
        social_links: access.profile.social_links,
        home_section_order: access.profile.home_section_order,
        is_official: access.profile.is_official,
        status: access.profile.status,
    };

    const updatedProfile =
        Object.keys(profilePayload).length > 0
            ? await updateOne(
                  "app_user_profiles",
                  access.profile.id,
                  profilePayload,
              )
            : currentProfile;
    if (Object.keys(directusUserPayload).length > 0) {
        try {
            await updateDirectusUserWithServiceAccess(
                access.user.id,
                directusUserPayload,
            );
            directusUser = await loadDirectusUserProfileFields(access.user.id);
            assertAvatarPersisted({
                avatarPatch,
                persistedAvatar: directusUser.avatar,
            });
        } catch (error) {
            if (avatarPatch.hasPatch) {
                await rollbackAvatarPatch({
                    userId: access.user.id,
                    previousAvatarFile: prevAvatarFile,
                });
            }
            throw error;
        }
    }

    try {
        await applyFileBindingsAndCleanup(
            body,
            input,
            avatarPatch,
            access,
            prevAvatarFile,
            prevHeaderFile,
        );
    } catch (error) {
        if (avatarPatch.hasPatch) {
            await rollbackAvatarPatch({
                userId: access.user.id,
                previousAvatarFile: prevAvatarFile,
            });
        }
        throw toAvatarSaveFailedError(error);
    }

    const profileView = buildUpdatedProfileView({
        updatedProfile,
        directusUser,
    });

    invalidateAuthorCache(access.user.id);
    invalidateOfficialSidebarCache();
    invalidateSessionUserCache(getSessionAccessToken(context));
    return ok({
        profile: toProfileResponse(profileView),
    });
}

export async function handleMyProfile(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        return await getMyProfile(access);
    }
    if (context.request.method === "PATCH") {
        return await patchMyProfile(context, access);
    }
    return fail("方法不允许", 405);
}
