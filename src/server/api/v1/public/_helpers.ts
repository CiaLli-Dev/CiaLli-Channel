import type { AppProfile } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { loadProfileByUsernameFromRepository } from "@/server/repositories/profile/profile.repository";

import { excludeSpecialArticleSlugFilter, filterPublicStatus } from "../shared";

export function toAuthorFallback(userId: string): {
    id: string;
    name: string;
    username?: string;
} {
    const normalized = String(userId || "").trim();
    const shortId = (normalized || "user").slice(0, 8);
    return {
        id: normalized,
        name: `user-${shortId}`,
        username: `user-${shortId}`,
    };
}

export function readAuthor(
    authorMap: Map<
        string,
        { id: string; name: string; username?: string; avatar_url?: string }
    >,
    userId: string,
): { id: string; name: string; username?: string; avatar_url?: string } {
    return authorMap.get(userId) || toAuthorFallback(userId);
}

export function normalizeAuthorHandle(value: string): string {
    return value.trim().replace(/^@+/, "").toLowerCase();
}

/** owner 可见全部；非 owner 仅可见 published + is_public + show_on_profile。 */
export function itemFiltersApi(isOwner: boolean): JsonObject[] {
    return isOwner
        ? []
        : [filterPublicStatus(), { show_on_profile: { _eq: true } }];
}

/** 文章过滤：非 owner 仅按公开状态过滤（文章不再有 show_on_profile） */
export function articleFiltersApi(isOwner: boolean): JsonObject[] {
    return isOwner
        ? [excludeSpecialArticleSlugFilter()]
        : [filterPublicStatus(), excludeSpecialArticleSlugFilter()];
}

export async function loadProfileByUsername(
    username: string,
): Promise<AppProfile | null> {
    return await loadProfileByUsernameFromRepository(username);
}
