import type { AppUser } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { readMany } from "@/server/directus/client";
import type { AppProfileWithUser } from "@/server/profile-view";

const PROFILE_BASE_FIELDS = [
    "id",
    "user_id",
    "username",
    "display_name",
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
];

const PROFILE_USER_RELATION_FIELDS = [
    "user.id",
    "user.email",
    "user.first_name",
    "user.last_name",
    "user.avatar",
    "user.description",
];

export async function readProfilesWithUsersFromRepository(
    userIds: string[],
): Promise<AppProfileWithUser[]> {
    try {
        return (await readMany("app_user_profiles", {
            filter: {
                user_id: { _in: userIds },
            } as JsonObject,
            fields: [...PROFILE_BASE_FIELDS, ...PROFILE_USER_RELATION_FIELDS],
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
            fields: [...PROFILE_BASE_FIELDS],
            limit: Math.max(userIds.length, 20),
        })) as AppProfileWithUser[];
    }
}

export async function readDirectusUsersByIdsFromRepository(
    userIds: string[],
): Promise<(Partial<AppUser> & { id: string })[]> {
    return await readMany("directus_users", {
        filter: {
            id: { _in: userIds },
        } as JsonObject,
        fields: ["id", "email", "first_name", "last_name", "avatar"],
        limit: Math.max(userIds.length, 20),
    });
}
