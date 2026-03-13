import type { AppProfile } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { readMany } from "@/server/directus/client";

export async function loadProfileByUsernameFromRepository(
    username: string,
): Promise<AppProfile | null> {
    const rows = await readMany("app_user_profiles", {
        filter: { username: { _eq: username } } as JsonObject,
        limit: 1,
    });
    return (rows[0] as AppProfile | undefined) ?? null;
}
