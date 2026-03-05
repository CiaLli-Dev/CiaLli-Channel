/**
 * Article 业务规则（纯函数，无 IO）
 *
 * 从以下位置提取而来：
 * - shared/auth.ts: filterPublicStatus()
 * - shared/loaders.ts: loadPublicArticle*
 * - comments.ts: allow_comments 检查
 */

import type { AppArticle, AppStatus } from "@/types/app";

import { isPubliclyVisible } from "@/server/domain/shared/visibility";
import { isValidTransition } from "@/server/domain/shared/status";

// ── 可见性规则 ──

/** 文章是否对公众可见（status=published && is_public=true） */
export function isArticlePubliclyVisible(
    article: Pick<AppArticle, "status" | "is_public">,
): boolean {
    return isPubliclyVisible(article);
}

// ── 状态转换规则 ──

/** 检查文章状态转换是否合法 */
export function canTransitionArticleStatus(
    from: AppStatus,
    to: AppStatus,
): boolean {
    return isValidTransition(from, to);
}

// ── 评论规则 ──

/** 文章是否允许评论 */
export function isArticleCommentable(
    article: Pick<AppArticle, "allow_comments" | "status" | "is_public">,
): boolean {
    return isArticlePubliclyVisible(article) && article.allow_comments === true;
}

// ── 权限规则 ──

/** 用户是否可以修改文章（owner 或 admin） */
export function canUserModifyArticle(
    userId: string,
    authorId: string,
    isAdmin: boolean,
): boolean {
    if (isAdmin) return true;
    return userId === authorId;
}

/** 判断是否为内容所有者 */
export function isOwner(viewerId: string | null, ownerId: string): boolean {
    return viewerId !== null && viewerId === ownerId;
}
