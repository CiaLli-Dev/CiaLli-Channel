import type { AppPermissions, AppProfile, AppRole, AppUser } from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    createOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import {
    composeUsernameWithSuffix,
    normalizeAutoUsername,
    normalizeRequestedUsername,
} from "@/server/auth/username";
import { conflict, forbidden } from "@/server/api/errors";

import type { SessionUser } from "./session";

export type AppAccessContext = {
    user: SessionUser;
    profile: AppProfile;
    permissions: AppPermissions;
    isAdmin: boolean;
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

function normalizeProfile(raw: Partial<AppProfile>): AppProfile {
    return {
        id: raw.id || "",
        user_id: raw.user_id || "",
        username: raw.username || "",
        display_name: raw.display_name || "",
        bio: raw.bio ?? null,
        bio_typewriter_enable: raw.bio_typewriter_enable ?? true,
        bio_typewriter_speed: Math.max(
            10,
            Math.min(500, Math.floor(Number(raw.bio_typewriter_speed) || 80)),
        ),
        avatar_file: raw.avatar_file ?? null,
        avatar_url: raw.avatar_url ?? null,
        header_file: raw.header_file ?? null,
        profile_public: raw.profile_public ?? true,
        show_articles_on_profile: raw.show_articles_on_profile ?? true,
        show_diaries_on_profile: raw.show_diaries_on_profile ?? true,
        show_bangumi_on_profile: raw.show_bangumi_on_profile ?? true,
        show_albums_on_profile: raw.show_albums_on_profile ?? true,
        show_comments_on_profile: raw.show_comments_on_profile ?? true,
        bangumi_username: raw.bangumi_username ?? null,
        bangumi_include_private: raw.bangumi_include_private ?? false,
        bangumi_access_token_encrypted:
            raw.bangumi_access_token_encrypted ?? null,
        social_links: raw.social_links ?? null,
        home_section_order: normalizeHomeSectionOrder(raw.home_section_order),
        is_official: raw.is_official ?? false,
        status: raw.status || "published",
    };
}

function normalizePermissions(raw: Partial<AppPermissions>): AppPermissions {
    return {
        id: raw.id || "",
        user_id: raw.user_id || "",
        app_role: (raw.app_role || "member") as AppRole,
        can_publish_articles: raw.can_publish_articles ?? true,
        can_comment_articles: raw.can_comment_articles ?? true,
        can_manage_diaries: raw.can_manage_diaries ?? true,
        can_comment_diaries: raw.can_comment_diaries ?? true,
        can_manage_anime: raw.can_manage_anime ?? true,
        can_manage_albums: raw.can_manage_albums ?? true,
        can_upload_files: raw.can_upload_files ?? true,
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

async function getDirectusUserById(userId: string): Promise<AppUser | null> {
    return await readOneById("directus_users", userId, {
        fields: [
            "id",
            "email",
            "first_name",
            "last_name",
            "avatar",
            "status",
            "role",
        ],
    });
}

export async function ensureAppIdentity(
    user: SessionUser,
): Promise<{ profile: AppProfile; permissions: AppPermissions }> {
    const profileRows = await readMany("app_user_profiles", {
        filter: {
            user_id: { _eq: user.id },
        } as JsonObject,
        limit: 1,
    });
    const permRows = await readMany("app_user_permissions", {
        filter: {
            user_id: { _eq: user.id },
        } as JsonObject,
        limit: 1,
    });

    const directusUser = await getDirectusUserById(user.id);
    const baseName =
        user.name ||
        directusUser?.first_name ||
        directusUser?.email ||
        user.email;

    let profile: AppProfile;
    if (profileRows.length > 0) {
        profile = normalizeProfile(profileRows[0]);
    } else {
        const username = await createUniqueUsername(
            baseName || user.email.split("@")[0] || user.id,
        );
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
            profile_public: true,
            show_articles_on_profile: true,
            show_diaries_on_profile: true,
            show_bangumi_on_profile: true,
            show_albums_on_profile: true,
            show_comments_on_profile: true,
            bangumi_username: null,
            bangumi_include_private: false,
            bangumi_access_token_encrypted: null,
        });
        profile = normalizeProfile(created);
    }

    let permissions: AppPermissions;
    if (permRows.length > 0) {
        permissions = normalizePermissions(permRows[0]);
    } else {
        const created = await createOne("app_user_permissions", {
            user_id: user.id,
            app_role: user.isSystemAdmin ? "admin" : "member",
            can_publish_articles: true,
            can_comment_articles: true,
            can_manage_diaries: true,
            can_comment_diaries: true,
            can_manage_anime: true,
            can_manage_albums: true,
            can_upload_files: true,
        });
        permissions = normalizePermissions(created);
    }

    // 系统管理员必须在应用层保持 admin 角色，避免双因子判定出现角色漂移。
    if (user.isSystemAdmin && permissions.app_role !== "admin") {
        if (permissions.id) {
            const synced = await updateOne(
                "app_user_permissions",
                permissions.id,
                {
                    app_role: "admin",
                },
            );
            permissions = normalizePermissions(synced);
        } else {
            permissions = {
                ...permissions,
                app_role: "admin",
            };
        }
    }

    return { profile, permissions };
}

export async function getAppAccessContext(
    user: SessionUser,
): Promise<AppAccessContext> {
    const { profile, permissions } = await ensureAppIdentity(user);
    return {
        user,
        profile,
        permissions,
        isAdmin: user.isSystemAdmin && permissions.app_role === "admin",
    };
}

export function assertCan(
    access: AppAccessContext,
    permission: keyof AppPermissions,
): void {
    if (access.isAdmin) {
        return;
    }
    if (permission in access.permissions) {
        const flag = access.permissions[permission];
        if (typeof flag === "boolean" && !flag) {
            throw forbidden();
        }
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
    return normalized;
}

export function normalizeTagsCsv(
    input: string | string[] | null | undefined,
): string[] {
    return toCsvArray(input);
}
