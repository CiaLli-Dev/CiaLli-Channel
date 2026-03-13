/**
 * 通用状态转换规则
 *
 * 状态枚举：draft | published | archived
 * 允许的转换路径定义在 VALID_TRANSITIONS 中。
 */

import type { AppStatus } from "@/types/app";

/**
 * 合法的状态转换矩阵
 *
 * - draft → published（发布）
 * - draft → archived（归档草稿）
 * - published → draft（撤回）
 * - published → archived（归档已发布内容）
 * - archived → draft（恢复为草稿）
 *
 * 注意：archived → published 不允许（需先恢复为 draft 再发布）
 */
const VALID_TRANSITIONS: ReadonlyMap<
    AppStatus,
    ReadonlySet<AppStatus>
> = new Map([
    ["draft", new Set(["published", "archived"] as AppStatus[])],
    ["published", new Set(["draft", "archived"] as AppStatus[])],
    ["archived", new Set(["draft"] as AppStatus[])],
]);

/** 检查状态转换是否合法 */
export function isValidTransition(from: AppStatus, to: AppStatus): boolean {
    if (from === to) return true;
    return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

/** 获取某状态可转换到的目标状态列表 */
export function getValidTargets(from: AppStatus): AppStatus[] {
    const targets = VALID_TRANSITIONS.get(from);
    return targets ? [...targets] : [];
}
