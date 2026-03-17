/**
 * User Repository — Directus 数据访问封装
 *
 * 将散落在 auth/acl.ts、shared/loaders.ts 中的用户/档案查询模式集中到此处。
 */

import type { AppProfile, AppPermissions } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { readMany, readOneById, updateOne } from "@/server/directus/client";
import { cacheManager } from "@/server/cache/manager";
import { invalidateAuthorCache } from "@/server/api/v1/shared/author-cache";

// ── Profile 查询 ──

export async function findProfileByUsername(
    username: string,
): Promise<AppProfile | null> {
    const rows = await readMany("app_user_profiles", {
        filter: { username: { _eq: username } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function findProfileByUserId(
    userId: string,
): Promise<AppProfile | null> {
    const rows = await readMany("app_user_profiles", {
        filter: { user_id: { _eq: userId } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function findProfileById(
    profileId: string,
): Promise<AppProfile | null> {
    return await readOneById("app_user_profiles", profileId);
}

// ── Profile 更新 ──

export async function updateProfile(
    profileId: string,
    payload: JsonObject,
    userId?: string,
): Promise<AppProfile> {
    const updated = await updateOne("app_user_profiles", profileId, payload);
    void cacheManager.invalidateByDomain("profile-viewer");
    if (userId) {
        invalidateAuthorCache(userId);
    }
    return updated;
}

// ── Permissions 查询 ──

export async function findPermissionsByUserId(
    userId: string,
): Promise<AppPermissions | null> {
    const rows = await readMany("app_user_permissions", {
        filter: { user_id: { _eq: userId } } as JsonObject,
        limit: 1,
    });
    return rows[0] || null;
}

export async function updatePermissions(
    permissionsId: string,
    payload: JsonObject,
): Promise<AppPermissions> {
    return await updateOne("app_user_permissions", permissionsId, payload);
}

// ── 用户名唯一性检查 ──

export async function isUsernameAvailable(
    username: string,
    excludeProfileId?: string,
): Promise<boolean> {
    const filters: JsonObject[] = [{ username: { _eq: username } }];
    if (excludeProfileId) {
        filters.push({ id: { _neq: excludeProfileId } });
    }
    const rows = await readMany("app_user_profiles", {
        filter: { _and: filters } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    return rows.length === 0;
}
