/**
 * User Service — 业务编排层
 *
 * 协调 User Rules 和 Repository，提供高层业务操作。
 */

import type { AppProfile } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { conflict } from "@/server/api/errors";

import {
    isProfilePubliclyVisible,
    isModuleVisibleOnProfile,
    isOwner,
} from "./user.rules";
import type { ProfileModule } from "./user.types";
import * as userRepo from "./user.repository";

// ── Profile 查询 ──

export async function getProfileByUsername(
    username: string,
): Promise<AppProfile | null> {
    return await userRepo.findProfileByUsername(username);
}

export async function getProfileByUserId(
    userId: string,
): Promise<AppProfile | null> {
    return await userRepo.findProfileByUserId(userId);
}

// ── Profile 可见性 ──

/** 检查用户主页是否对指定访问者可见 */
export function checkProfileVisible(
    profile: Pick<AppProfile, "profile_public" | "user_id">,
    viewerId: string | null,
): boolean {
    const ownerViewing = isOwner(viewerId, profile.user_id);
    return isProfilePubliclyVisible(profile, ownerViewing);
}

/** 检查用户主页某模块是否对指定访问者可见 */
export function checkModuleVisible(
    profile: AppProfile,
    module: ProfileModule,
    viewerId: string | null,
): boolean {
    const ownerViewing = isOwner(viewerId, profile.user_id);
    return isModuleVisibleOnProfile(profile, module, ownerViewing);
}

// ── Profile 更新 ──

export async function updateProfile(
    profileId: string,
    payload: JsonObject,
    userId: string,
): Promise<AppProfile> {
    return await userRepo.updateProfile(profileId, payload, userId);
}

// ── 用户名 ──

export async function ensureUsernameAvailable(
    username: string,
    excludeProfileId?: string,
): Promise<void> {
    const available = await userRepo.isUsernameAvailable(
        username,
        excludeProfileId,
    );
    if (!available) {
        throw conflict("USERNAME_EXISTS", "用户名已存在");
    }
}
