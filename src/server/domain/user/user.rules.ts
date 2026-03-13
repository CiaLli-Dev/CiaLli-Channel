/**
 * User/Profile 业务规则（纯函数，无 IO）
 *
 * 从以下位置提取而来：
 * - public/user-home.ts: profile_public、show_*_on_profile、isOwnerViewing
 * - auth/acl.ts: assertCan、assertOwnerOrAdmin、isAdmin 判定
 */

import type { AppPermissions, AppProfile } from "@/types/app";

import type { ProfileModule } from "./user.types";
import { MODULE_VISIBILITY_FIELDS } from "./user.types";

// ── Profile 公开性 ──

/** 用户主页是否对外可见 */
export function isProfilePubliclyVisible(
    profile: Pick<AppProfile, "profile_public">,
    isOwnerViewing: boolean,
): boolean {
    if (isOwnerViewing) return true;
    return profile.profile_public === true;
}

// ── 模块可见性 ──

/** 用户主页某模块是否可见 */
export function isModuleVisibleOnProfile(
    profile: AppProfile,
    module: ProfileModule,
    isOwnerViewing: boolean,
): boolean {
    if (isOwnerViewing) return true;
    const field = MODULE_VISIBILITY_FIELDS[module];
    return profile[field] === true;
}

// ── 权限判定 ──

/** 用户是否拥有指定功能权限（admin 直接放行） */
export function hasPermission(
    permissions: AppPermissions,
    permission: keyof AppPermissions,
    isAdmin: boolean,
): boolean {
    if (isAdmin) return true;
    const flag = permissions[permission];
    return typeof flag === "boolean" ? flag : true;
}

// ── 所有权判定 ──

/** 判断查看者是否为内容所有者 */
export function isOwner(viewerId: string | null, ownerId: string): boolean {
    return viewerId !== null && viewerId === ownerId;
}

/** 判断用户是否可以操作目标资源（owner 或 admin） */
export function canModifyResource(
    userId: string,
    ownerId: string,
    isAdmin: boolean,
): boolean {
    if (isAdmin) return true;
    return userId === ownerId;
}
