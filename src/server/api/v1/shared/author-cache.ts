import type { AppProfileView, AppUser } from "@/types/app";
import { cacheManager } from "@/server/cache/manager";
import {
    toAppProfileView,
    type AppProfileWithUser,
} from "@/server/profile-view";
import { buildPublicAssetUrl } from "@/server/directus-auth";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import {
    readProfilesWithUsersFromRepository,
    readDirectusUsersByIdsFromRepository,
} from "@/server/repositories/author/author.repository";

export type AuthorBundleItem = {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
};

export function createFallbackAuthorBundle(
    userId: string,
    options: { emptySeed?: string; includeDisplayName?: boolean } = {},
): AuthorBundleItem {
    const normalized = String(userId || "").trim();
    const shortId = (normalized || options.emptySeed || "user").slice(0, 8);
    const username = `user-${shortId}`;
    return {
        id: normalized,
        name: username,
        ...(options.includeDisplayName ? { display_name: username } : {}),
        username,
    };
}

export function readAuthor(
    authorMap: Map<string, AuthorBundleItem>,
    userId: string,
): AuthorBundleItem {
    return authorMap.get(userId) || createFallbackAuthorBundle(userId);
}

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
    return await readProfilesWithUsersFromRepository(userIds);
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
        const users = await withServiceRepositoryContext(
            async () =>
                await readDirectusUsersByIdsFromRepository(missingUserIds),
        );
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
