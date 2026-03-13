/**
 * 通用公开可见性判定（所有实体共用）
 *
 * 规则：status === "published" && is_public === true
 */

import type { AppStatus } from "@/types/app";

export interface PublicVisibleItem {
    status: AppStatus;
    is_public: boolean;
}

/** 内容是否对公众可见 */
export function isPubliclyVisible(item: PublicVisibleItem): boolean {
    return item.status === "published" && item.is_public === true;
}

export interface ProfileVisibleItem extends PublicVisibleItem {
    show_on_profile: boolean;
}

/** 内容是否在用户主页可见（非 owner 时需要额外检查 show_on_profile） */
export function isVisibleOnProfile(
    item: ProfileVisibleItem,
    isOwnerViewing: boolean,
): boolean {
    if (isOwnerViewing) return true;
    return isPubliclyVisible(item) && item.show_on_profile === true;
}
