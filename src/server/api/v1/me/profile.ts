import type { APIContext } from "astro";

import type { AppProfile, AppProfileView } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { updateProfileUsername } from "@/server/auth/acl";
import { validateDisplayName } from "@/server/auth/username";
import { encryptBangumiAccessToken } from "@/server/bangumi/token";
import { normalizeBangumiId } from "@/server/bangumi/username";
import { toAppProfileView } from "@/server/profile-view";
import { updateDirectusUser, updateOne } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { UpdateProfileSchema } from "@/server/api/schemas";
import type { UpdateProfileInput } from "@/server/api/schemas";

import type { AppAccess } from "../shared";
import { hasOwn, parseProfileBioField } from "../shared";
import { invalidateAuthorCache } from "../shared/author-cache";
import { invalidateOfficialSidebarCache } from "../public-data";
import { cleanupOwnedOrphanDirectusFiles } from "../shared/file-cleanup";
import { bindFileOwnerToUser } from "./_helpers";

type ProfileInput = UpdateProfileInput;

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
    const VALID_SECTIONS = new Set([
        "articles",
        "diaries",
        "bangumi",
        "albums",
    ]);
    if (order === null || order === undefined) {
        return null;
    }
    const deduped = [...new Set(order.filter((s) => VALID_SECTIONS.has(s)))];
    for (const section of VALID_SECTIONS) {
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
    if (input.bio_typewriter_enable !== undefined) {
        payload.bio_typewriter_enable = input.bio_typewriter_enable;
    }
    if (input.bio_typewriter_speed !== undefined) {
        payload.bio_typewriter_speed = input.bio_typewriter_speed;
    }
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
    body: JsonObject,
    input: ProfileInput,
): JsonObject {
    const payload: JsonObject = {};
    if (input.bio !== undefined) {
        payload.description = parseProfileBioField(input.bio);
    }
    if (hasOwn(body, "avatar_file")) {
        payload.avatar = input.avatar_file ?? null;
    }
    return payload;
}

async function applyAvatarFileBindings(
    body: JsonObject,
    input: ProfileInput,
    access: AppAccess,
    prevAvatarFile: string | null,
): Promise<void> {
    const hasAvatarFilePatch = hasOwn(body, "avatar_file");
    const nextAvatarFile = hasAvatarFilePatch
        ? (input.avatar_file ?? null)
        : prevAvatarFile;
    const nextProfilePublic =
        input.profile_public ?? access.profile.profile_public;

    if (hasAvatarFilePatch && nextAvatarFile) {
        await bindFileOwnerToUser(
            nextAvatarFile,
            access.user.id,
            undefined,
            nextProfilePublic ? "public" : "private",
        );
    }
    if (
        hasAvatarFilePatch &&
        prevAvatarFile &&
        prevAvatarFile !== nextAvatarFile
    ) {
        await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [prevAvatarFile],
            ownerUserIds: [access.user.id],
        });
    }
}

async function applyHeaderFileBindings(
    body: JsonObject,
    input: ProfileInput,
    userId: string,
    prevHeaderFile: string | null,
    currentProfilePublic: boolean,
): Promise<void> {
    const hasHeaderFilePatch = hasOwn(body, "header_file");
    const nextHeaderFile = hasHeaderFilePatch
        ? (input.header_file ?? null)
        : prevHeaderFile;
    const nextProfilePublic = input.profile_public ?? currentProfilePublic;

    if (hasHeaderFilePatch && nextHeaderFile) {
        await bindFileOwnerToUser(
            nextHeaderFile,
            userId,
            undefined,
            nextProfilePublic ? "public" : "private",
        );
    }
    if (
        hasHeaderFilePatch &&
        prevHeaderFile &&
        prevHeaderFile !== nextHeaderFile
    ) {
        await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [prevHeaderFile],
            ownerUserIds: [userId],
        });
    }
}

async function applyFileBindingsAndCleanup(
    body: JsonObject,
    input: ProfileInput,
    access: AppAccess,
    prevAvatarFile: string | null,
    prevHeaderFile: string | null,
): Promise<void> {
    await applyAvatarFileBindings(body, input, access, prevAvatarFile);
    await applyHeaderFileBindings(
        body,
        input,
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
            );
        }
        if (prevHeaderFile && !hasOwn(body, "header_file")) {
            await bindFileOwnerToUser(
                prevHeaderFile,
                access.user.id,
                undefined,
                visibility,
            );
        }
    }
}

function buildUpdatedProfileView(params: {
    access: AppAccess;
    updatedProfile: AppProfile;
    input: ProfileInput;
    body: JsonObject;
}): AppProfileView {
    const { access, updatedProfile, input, body } = params;
    return toAppProfileView(updatedProfile, {
        avatar: hasOwn(body, "avatar_file")
            ? (input.avatar_file ?? null)
            : access.profile.avatar_file,
        description:
            input.bio !== undefined
                ? parseProfileBioField(input.bio)
                : access.profile.bio,
    });
}

async function handleGet(access: AppAccess): Promise<Response> {
    return ok({
        profile: toProfileResponse(access.profile),
    });
}

async function handlePatch(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateProfileSchema, body);
    const profilePayload = buildProfilePatchPayload(body, input);
    const directusUserPayload = buildDirectusUserPatchPayload(body, input);

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

    const prevAvatarFile = access.profile.avatar_file;
    const prevHeaderFile = access.profile.header_file;
    const currentProfile: AppProfile = {
        id: access.profile.id,
        user_id: access.profile.user_id,
        username: access.profile.username,
        display_name: access.profile.display_name,
        bio_typewriter_enable: access.profile.bio_typewriter_enable,
        bio_typewriter_speed: access.profile.bio_typewriter_speed,
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
        await updateDirectusUser(access.user.id, directusUserPayload);
    }

    await applyFileBindingsAndCleanup(
        body,
        input,
        access,
        prevAvatarFile,
        prevHeaderFile,
    );

    const profileView = buildUpdatedProfileView({
        access,
        updatedProfile,
        input,
        body,
    });

    invalidateAuthorCache(access.user.id);
    invalidateOfficialSidebarCache();
    return ok({
        profile: toProfileResponse(profileView),
    });
}

export async function handleMeProfile(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        return handleGet(access);
    }
    if (context.request.method === "PATCH") {
        return handlePatch(context, access);
    }
    return fail("方法不允许", 405);
}
