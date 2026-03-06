import type { AppProfileView, AppUser } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { cacheManager } from "@/server/cache/manager";
import { readMany } from "@/server/directus/client";
import {
    toAppProfileView,
    type AppProfileWithUser,
} from "@/server/profile-view";
import { buildPublicAssetUrl } from "@/server/directus-auth";

export type AuthorBundleItem = {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
};

function computeDisplayName(
    user?: Partial<AppUser> | null,
): string | undefined {
    if (!user) {
        return undefined;
    }
    const fullName = [user.first_name, user.last_name]
        .map((entry) => (entry || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();
    if (fullName) {
        return fullName;
    }
    const email = typeof user.email === "string" ? user.email.trim() : "";
    if (email) {
        return email.split("@")[0] || email;
    }
    return undefined;
}

function normalizeUsername(
    rawUsername: string | null | undefined,
    userId: string,
): string {
    const raw = String(rawUsername || "").trim();
    if (!raw) {
        return `user-${String(userId || "").slice(0, 8)}`;
    }
    if (!raw.includes("@")) {
        return raw;
    }
    return (
        (raw.split("@")[0] || "").trim() ||
        `user-${String(userId || "").slice(0, 8)}`
    );
}

function resolveAvatarUrl(
    profile: AppProfileView | null,
    user: Partial<AppUser> | null,
): string | undefined {
    if (profile?.avatar_file) {
        return buildPublicAssetUrl(profile.avatar_file, {
            width: 96,
            height: 96,
            fit: "cover",
        });
    }
    if (user?.avatar) {
        return buildPublicAssetUrl(user.avatar, {
            width: 96,
            height: 96,
            fit: "cover",
        });
    }
    return undefined;
}

function toAuthorBundle(
    userId: string,
    profile: AppProfileView | null,
    user: Partial<AppUser> | null,
): AuthorBundleItem {
    const username = normalizeUsername(profile?.username, userId);
    const displayName =
        String(profile?.display_name || "").trim() || computeDisplayName(user);
    return {
        id: userId,
        name: username || displayName || "Member",
        display_name: displayName || username || "Member",
        username,
        avatar_url: resolveAvatarUrl(profile, user),
    };
}

function uniqueUserIds(userIds: string[]): string[] {
    return Array.from(
        new Set(
            userIds.map((entry) => String(entry || "").trim()).filter(Boolean),
        ),
    );
}

async function readProfiles(userIds: string[]): Promise<AppProfileWithUser[]> {
    try {
        return (await readMany("app_user_profiles", {
            filter: {
                user_id: { _in: userIds },
            } as JsonObject,
            fields: [
                "id",
                "user_id",
                "username",
                "display_name",
                "bio_typewriter_enable",
                "bio_typewriter_speed",
                "header_file",
                "profile_public",
                "show_articles_on_profile",
                "show_diaries_on_profile",
                "show_bangumi_on_profile",
                "show_albums_on_profile",
                "show_comments_on_profile",
                "bangumi_username",
                "bangumi_include_private",
                "bangumi_access_token_encrypted",
                "social_links",
                "home_section_order",
                "is_official",
                "status",
                "user.id",
                "user.email",
                "user.first_name",
                "user.last_name",
                "user.avatar",
                "user.description",
            ],
            limit: Math.max(userIds.length, 20),
        })) as AppProfileWithUser[];
    } catch (error) {
        console.warn(
            "[api/v1/author-cache] profile relation query failed, fallback:",
            error,
        );
        return (await readMany("app_user_profiles", {
            filter: {
                user_id: { _in: userIds },
            } as JsonObject,
            fields: [
                "id",
                "user_id",
                "username",
                "display_name",
                "bio_typewriter_enable",
                "bio_typewriter_speed",
                "header_file",
                "profile_public",
                "show_articles_on_profile",
                "show_diaries_on_profile",
                "show_bangumi_on_profile",
                "show_albums_on_profile",
                "show_comments_on_profile",
                "bangumi_username",
                "bangumi_include_private",
                "bangumi_access_token_encrypted",
                "social_links",
                "home_section_order",
                "is_official",
                "status",
            ],
            limit: Math.max(userIds.length, 20),
        })) as AppProfileWithUser[];
    }
}

async function fetchAuthorsForUsers(
    userIds: string[],
): Promise<Map<string, AuthorBundleItem>> {
    const result = new Map<string, AuthorBundleItem>();
    if (userIds.length === 0) {
        return result;
    }

    const profiles = await readProfiles(userIds);
    const profileMap = new Map<string, AppProfileView>();
    const relationUserMap = new Map<string, Partial<AppUser>>();

    for (const profile of profiles) {
        if (!profile.user_id) {
            continue;
        }
        profileMap.set(
            profile.user_id,
            toAppProfileView(profile, profile.user),
        );
        if (profile.user) {
            relationUserMap.set(profile.user_id, profile.user);
        }
    }

    const missingUserIds = userIds.filter(
        (userId) => !relationUserMap.has(userId),
    );
    const userMap = new Map<string, Partial<AppUser>>();
    for (const [userId, relationUser] of relationUserMap.entries()) {
        userMap.set(userId, relationUser);
    }

    if (missingUserIds.length > 0) {
        const users = await readMany("directus_users", {
            filter: {
                id: { _in: missingUserIds },
            } as JsonObject,
            fields: ["id", "email", "first_name", "last_name", "avatar"],
            limit: Math.max(missingUserIds.length, 20),
        });
        for (const user of users) {
            userMap.set(user.id, user);
        }
    }

    for (const userId of userIds) {
        result.set(
            userId,
            toAuthorBundle(
                userId,
                profileMap.get(userId) || null,
                userMap.get(userId) || null,
            ),
        );
    }

    return result;
}

export async function invalidateAuthorCacheAsync(
    userId: string,
): Promise<void> {
    const id = String(userId || "").trim();
    if (id) {
        await cacheManager.invalidate("author", id);
    }
}

export function invalidateAuthorCache(userId: string): void {
    void invalidateAuthorCacheAsync(userId);
}

export function invalidateAuthorCacheByUsers(userIds: string[]): void {
    for (const userId of userIds) {
        invalidateAuthorCache(userId);
    }
}

export async function getAuthorBundle(
    userIds: string[],
): Promise<Map<string, AuthorBundleItem>> {
    const normalizedIds = uniqueUserIds(userIds);
    const result = new Map<string, AuthorBundleItem>();
    const cacheHits = await Promise.all(
        normalizedIds.map(async (userId) => ({
            userId,
            cached: await cacheManager.get<AuthorBundleItem>("author", userId),
        })),
    );
    const missIds = cacheHits
        .filter((entry) => !entry.cached)
        .map((entry) => entry.userId);
    for (const entry of cacheHits) {
        if (entry.cached) {
            result.set(entry.userId, entry.cached);
        }
    }

    if (missIds.length > 0) {
        const fetched = await fetchAuthorsForUsers(missIds);
        const pendingSets: Array<Promise<void>> = [];
        for (const [userId, bundle] of fetched.entries()) {
            pendingSets.push(cacheManager.set("author", userId, bundle));
            result.set(userId, bundle);
        }
        void Promise.all(pendingSets);
    }

    return result;
}
