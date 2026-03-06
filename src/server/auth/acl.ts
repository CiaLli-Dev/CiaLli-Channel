import type { AppPermissionKey, AppPermissions, AppProfile } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { conflict, forbidden } from "@/server/api/errors";
import { cacheManager } from "@/server/cache/manager";
import { createOne, readMany, updateOne } from "@/server/directus/client";
import {
    buildPermissionsFromDirectus,
    isSiteAdminRoleName,
} from "@/server/auth/directus-access";
import {
    composeUsernameWithSuffix,
    normalizeAutoUsername,
    normalizeRequestedUsername,
} from "@/server/auth/username";

import type { SessionUser } from "./session";

export type AppAccessContext = {
    user: SessionUser;
    profile: AppProfile;
    permissions: AppPermissions;
    isAdmin: boolean;
    isSiteAdmin: boolean;
    isPlatformAdmin: boolean;
};

function toCsvArray(input: string | string[] | null | undefined): string[] {
    if (!input) {
        return [];
    }
    if (Array.isArray(input)) {
        return input.map((entry) => String(entry).trim()).filter(Boolean);
    }
    return input
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function normalizeHomeSectionOrder(input: unknown): string[] | null {
    if (!Array.isArray(input)) {
        return null;
    }
    return input
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .map((item) => (item === "anime" ? "bangumi" : item));
}

function clampTypingSpeed(raw: Partial<AppProfile>): number {
    return Math.max(
        10,
        Math.min(500, Math.floor(Number(raw.bio_typewriter_speed) || 80)),
    );
}

function normalizeProfileIdentity(
    raw: Partial<AppProfile>,
): Pick<AppProfile, "id" | "user_id" | "username" | "display_name" | "status"> {
    return {
        id: raw.id || "",
        user_id: raw.user_id || "",
        username: raw.username || "",
        display_name: raw.display_name || "",
        status: raw.status || "published",
    };
}

function normalizeProfileMedia(
    raw: Partial<AppProfile>,
): Pick<AppProfile, "avatar_file" | "avatar_url" | "header_file"> {
    return {
        avatar_file: raw.avatar_file ?? null,
        avatar_url: raw.avatar_url ?? null,
        header_file: raw.header_file ?? null,
    };
}

function normalizeProfileVisibility(
    raw: Partial<AppProfile>,
): Pick<
    AppProfile,
    | "profile_public"
    | "show_articles_on_profile"
    | "show_diaries_on_profile"
    | "show_bangumi_on_profile"
    | "show_albums_on_profile"
    | "show_comments_on_profile"
> {
    return {
        profile_public: raw.profile_public ?? true,
        show_articles_on_profile: raw.show_articles_on_profile ?? true,
        show_diaries_on_profile: raw.show_diaries_on_profile ?? true,
        show_bangumi_on_profile: raw.show_bangumi_on_profile ?? true,
        show_albums_on_profile: raw.show_albums_on_profile ?? true,
        show_comments_on_profile: raw.show_comments_on_profile ?? true,
    };
}

function normalizeProfileBangumi(
    raw: Partial<AppProfile>,
): Pick<
    AppProfile,
    | "bangumi_username"
    | "bangumi_include_private"
    | "bangumi_access_token_encrypted"
> {
    return {
        bangumi_username: raw.bangumi_username ?? null,
        bangumi_include_private: raw.bangumi_include_private ?? false,
        bangumi_access_token_encrypted:
            raw.bangumi_access_token_encrypted ?? null,
    };
}

function normalizeProfile(raw: Partial<AppProfile>): AppProfile {
    return {
        ...normalizeProfileIdentity(raw),
        bio: raw.bio ?? null,
        bio_typewriter_enable: raw.bio_typewriter_enable ?? true,
        bio_typewriter_speed: clampTypingSpeed(raw),
        ...normalizeProfileMedia(raw),
        ...normalizeProfileVisibility(raw),
        ...normalizeProfileBangumi(raw),
        social_links: raw.social_links ?? null,
        home_section_order: normalizeHomeSectionOrder(raw.home_section_order),
        is_official: raw.is_official ?? false,
    };
}

async function userExistsByUsername(username: string): Promise<boolean> {
    const rows = await readMany("app_user_profiles", {
        filter: {
            username: { _eq: username },
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    return rows.length > 0;
}

export async function createUniqueUsername(
    baseUsername: string,
): Promise<string> {
    const initial = normalizeAutoUsername(baseUsername);
    if (!(await userExistsByUsername(initial))) {
        return initial;
    }
    for (let index = 1; index < 1000; index += 1) {
        const candidate = composeUsernameWithSuffix(initial, `-${index}`);
        if (!(await userExistsByUsername(candidate))) {
            return candidate;
        }
    }
    return composeUsernameWithSuffix(
        initial,
        `-${String(Date.now()).slice(-4)}`,
    );
}

async function ensureProfile(user: SessionUser): Promise<AppProfile> {
    const rows = await readMany("app_user_profiles", {
        filter: {
            user_id: { _eq: user.id },
        } as JsonObject,
        limit: 1,
    });
    if (rows.length > 0) {
        return normalizeProfile(rows[0]);
    }

    const baseName = user.name || user.email.split("@")[0] || user.id;
    const username = await createUniqueUsername(baseName);
    const created = await createOne("app_user_profiles", {
        status: "published",
        user_id: user.id,
        username,
        display_name: username,
        bio: null,
        bio_typewriter_enable: true,
        bio_typewriter_speed: 80,
        avatar_file: null,
        avatar_url: user.avatarUrl || null,
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
    return normalizeProfile(created);
}

export async function getAppAccessContext(
    user: SessionUser,
): Promise<AppAccessContext> {
    const profile = await ensureProfile(user);
    const permissions = buildPermissionsFromDirectus({
        roleName: user.roleName,
        policyNames: user.policyNames,
        isPlatformAdmin: user.isSystemAdmin,
    });
    const isPlatformAdmin = user.isSystemAdmin;
    const isSiteAdmin = isSiteAdminRoleName(user.roleName);
    return {
        user,
        profile,
        permissions,
        isAdmin: isPlatformAdmin || isSiteAdmin,
        isSiteAdmin,
        isPlatformAdmin,
    };
}

export function assertCan(
    access: AppAccessContext,
    permission: AppPermissionKey,
): void {
    if (access.isAdmin) {
        return;
    }
    if (!access.permissions[permission]) {
        throw forbidden();
    }
}

export function assertOwnerOrAdmin(
    access: AppAccessContext,
    ownerId: string,
): void {
    if (access.isAdmin) {
        return;
    }
    if (access.user.id !== ownerId) {
        throw forbidden();
    }
}

export async function updateProfileUsername(
    profileId: string,
    requested: string,
): Promise<string> {
    const normalized = normalizeRequestedUsername(requested);
    const rows = await readMany("app_user_profiles", {
        filter: {
            _and: [
                { username: { _eq: normalized } },
                { id: { _neq: profileId } },
            ],
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    if (rows.length > 0) {
        throw conflict("USERNAME_EXISTS", "用户名已存在");
    }
    await updateOne("app_user_profiles", profileId, {
        username: normalized,
    });
    void cacheManager.invalidateByDomain("profile-viewer");
    return normalized;
}

export function normalizeTagsCsv(
    input: string | string[] | null | undefined,
): string[] {
    return toCsvArray(input);
}
