import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import { updateProfileUsername } from "@/server/auth/acl";
import { validateDisplayName } from "@/server/auth/username";
import { encryptBangumiAccessToken } from "@/server/bangumi/token";
import { normalizeBangumiId } from "@/server/bangumi/username";
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
import { cleanupOrphanDirectusFiles } from "../shared/file-cleanup";
import { bindFileOwnerToUser } from "./_helpers";

type ProfileInput = UpdateProfileInput;

function toProfileResponse(profile: AppAccess["profile"]): JsonObject {
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
    for (const s of VALID_SECTIONS) {
        if (!deduped.includes(s)) {
            deduped.push(s);
        }
    }
    return deduped;
}

function applyBasicFields(
    body: JsonObject,
    input: ProfileInput,
    payload: JsonObject,
): void {
    if (input.bio !== undefined) {
        payload.bio = parseProfileBioField(input.bio);
    }
    if (input.bio_typewriter_enable !== undefined) {
        payload.bio_typewriter_enable = input.bio_typewriter_enable;
    }
    if (input.bio_typewriter_speed !== undefined) {
        payload.bio_typewriter_speed = input.bio_typewriter_speed;
    }
    if (hasOwn(body, "avatar_file")) {
        payload.avatar_file = input.avatar_file ?? null;
    }
    if (hasOwn(body, "avatar_url")) {
        payload.avatar_url = input.avatar_url ?? null;
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

function buildPatchPayload(body: JsonObject, input: ProfileInput): JsonObject {
    const payload: JsonObject = {};
    applyBasicFields(body, input, payload);
    applyBangumiFields(body, input, payload);
    return payload;
}

// eslint-disable-next-line complexity -- 头像文件、外链头像与公开性需要联动处理
async function applyAvatarFileBindings(
    body: JsonObject,
    input: ProfileInput,
    access: AppAccess,
    prevAvatarFile: string | null | undefined,
): Promise<void> {
    const hasAvatarFilePatch = hasOwn(body, "avatar_file");
    const hasAvatarUrlPatch = hasOwn(body, "avatar_url");
    const nextAvatarFile = hasAvatarFilePatch
        ? (input.avatar_file ?? null)
        : prevAvatarFile;
    const nextAvatarUrl = hasAvatarUrlPatch
        ? (input.avatar_url ?? null)
        : access.profile.avatar_url;
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
        await cleanupOrphanDirectusFiles([prevAvatarFile]);
    }
    const shouldClearDirectusAvatar =
        (hasAvatarFilePatch || hasAvatarUrlPatch) &&
        !nextAvatarFile &&
        !nextAvatarUrl;
    if (shouldClearDirectusAvatar) {
        await updateDirectusUser(access.user.id, { avatar: null });
    }
}

async function applyHeaderFileBindings(
    body: JsonObject,
    input: ProfileInput,
    userId: string,
    prevHeaderFile: string | null | undefined,
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
        await cleanupOrphanDirectusFiles([prevHeaderFile]);
    }
}

async function applyFileBindingsAndCleanup(
    body: JsonObject,
    input: ProfileInput,
    access: AppAccess,
    prevAvatarFile: string | null | undefined,
    prevHeaderFile: string | null | undefined,
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
    const payload = buildPatchPayload(body, input);

    if (input.username !== undefined) {
        const normalized = await updateProfileUsername(
            access.profile.id,
            input.username,
        );
        payload.username = normalized;
    }
    if (input.display_name !== undefined) {
        payload.display_name = validateDisplayName(input.display_name);
    }

    const prevAvatarFile = access.profile.avatar_file;
    const prevHeaderFile = access.profile.header_file;

    const updated = await updateOne(
        "app_user_profiles",
        access.profile.id,
        payload,
    );

    await applyFileBindingsAndCleanup(
        body,
        input,
        access,
        prevAvatarFile,
        prevHeaderFile,
    );

    invalidateAuthorCache(access.user.id);
    invalidateOfficialSidebarCache();
    return ok({
        profile: toProfileResponse(updated),
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
