import type {
    CommentItem,
    TopLevelReplyExpandState,
} from "@/scripts/comments-types";
import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    escapeHtml,
    formatDate,
    getAuthorName,
    getAuthorProfileHref,
    normalizeMarkdownHtml,
    getVisibleRepliesForRender,
    isTopLevelReplyToggleTarget,
} from "@/scripts/comments-helpers";

// ---- 骨架屏渲染 ----

function renderSkeletonItem(index: number): string {
    const primaryLineWidth =
        index % 3 === 0 ? "92%" : index % 3 === 1 ? "86%" : "95%";
    const secondaryLineWidth =
        index % 2 === 0 ? "74%" : index % 2 === 1 ? "68%" : "72%";
    const tertiaryLineWidth =
        index % 2 === 0 ? "62%" : index % 2 === 1 ? "58%" : "64%";
    return `
    <div class="rounded-xl border border-(--line-divider) p-4 space-y-3" aria-hidden="true">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <div class="md3-skeleton-circle w-8 h-8 shrink-0"></div>
          <div class="min-w-0 flex-1 space-y-2">
            <div class="md3-skeleton-text" style="--skeleton-width: 8rem; --skeleton-height: 0.95rem;"></div>
            <div class="md3-skeleton-text" style="--skeleton-width: 6.5rem; --skeleton-height: 0.75rem;"></div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <div class="md3-skeleton-block h-8 w-14 rounded-lg"></div>
          <div class="md3-skeleton-block h-8 w-14 rounded-lg"></div>
        </div>
      </div>
      <div class="space-y-2">
        <div class="md3-skeleton-text" style="--skeleton-width: ${primaryLineWidth};"></div>
        <div class="md3-skeleton-text" style="--skeleton-width: ${secondaryLineWidth};"></div>
        <div class="md3-skeleton-text" style="--skeleton-width: ${tertiaryLineWidth};"></div>
      </div>
    </div>
  `;
}

export function renderCommentSkeletonList(count = 3): string {
    return Array.from({ length: count }, (_, index) =>
        renderSkeletonItem(index),
    ).join("");
}

// ---- 评论节点渲染 ----

function buildAvatarHtml(item: CommentItem, authorHref: string | null): string {
    const avatarContent = item.author?.avatar_url
        ? `<img src="${escapeHtml(item.author.avatar_url)}" alt="用户头像" class="w-8 h-8 rounded-full object-cover" loading="lazy" />`
        : `<div class="w-8 h-8 rounded-full bg-black/10 dark:bg-white/10"></div>`;
    return authorHref
        ? `<a href="${escapeHtml(authorHref)}" class="block rounded-full hover:opacity-90 transition-opacity">${avatarContent}</a>`
        : avatarContent;
}

function buildAuthorNameHtml(
    authorName: string,
    authorHref: string | null,
): string {
    return authorHref
        ? `<a href="${escapeHtml(authorHref)}" class="truncate text-90 hover:text-(--primary) transition-colors">${escapeHtml(authorName)}</a>`
        : `<span class="truncate text-90">${escapeHtml(authorName)}</span>`;
}

function buildToggleButtonHtml(
    canToggleReplies: boolean,
    parentId: string,
    expanded: boolean,
    hiddenCount: number,
    repliesContainerId: string,
): string {
    if (!canToggleReplies || !parentId) return "";
    const label = expanded
        ? "收起评论"
        : `查看更多（+${escapeHtml(String(hiddenCount))}）`;
    return `<button type="button" class="comment-action mt-2 inline-flex items-center gap-1 rounded-lg border border-(--line-divider) px-3 py-1.5 text-xs text-60 hover:text-(--primary) transition-colors" data-action="toggle-replies" data-parent-id="${escapeHtml(parentId)}" aria-expanded="${expanded ? "true" : "false"}" aria-controls="${repliesContainerId}">${label}</button>`;
}

function buildActionMenu(commentId: string, deleteLabel: string): string {
    const deleteBtn = `<button type="button" class="comment-action w-full text-left px-3 py-2 rounded-lg text-sm text-red-500 whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/10" data-action="delete" data-id="${escapeHtml(commentId)}">${escapeHtml(deleteLabel)}</button>`;
    return `
    <details class="relative comment-action-menu z-20">
      <summary class="list-none cursor-pointer btn-plain scale-animation w-8 h-8 rounded-lg flex items-center justify-center text-base select-none text-75" aria-label="评论操作">...</summary>
      <div class="absolute right-0 top-9 z-50 min-w-[11rem] card-base rounded-xl border border-(--line-divider) p-2 text-90">
        ${deleteBtn}
      </div>
    </details>
  `;
}

function renderCommentActions(
    item: CommentItem,
    level: number,
    currentUserId: string,
    isAdmin: boolean,
    pendingLikeCommentIds: Set<string>,
): string {
    const canReply = level < 2;
    const isOwner =
        Boolean(currentUserId) &&
        Boolean(item) &&
        item.author_id === currentUserId;
    const canDelete = isOwner || isAdmin;
    const isAdminOnlyDelete = isAdmin && !isOwner;
    const deleteLabel = isAdminOnlyDelete
        ? t(I18nKey.interactionCommonDeleteAdmin)
        : t(I18nKey.interactionCommonDelete);
    const replyCount = Array.isArray(item.replies) ? item.replies.length : 0;
    const likedByViewer = Boolean(item.liked_by_viewer);
    const likeCount = Math.max(0, Number(item.like_count || 0));
    const likePending = pendingLikeCommentIds.has(item.id);
    const likeClass = likedByViewer ? "text-(--primary)" : "text-60";
    const likePendingClass = likePending
        ? "opacity-60 pointer-events-none"
        : "";
    const likePendingAttr = likePending ? "disabled" : "";
    const replyButton = canReply
        ? `<button type="button" class="comment-action inline-flex h-8 items-center gap-1 text-sm font-medium text-60 hover:text-(--primary) transition-colors" data-action="reply" data-id="${escapeHtml(item.id)}" data-author="${escapeHtml(item.author?.name || "用户")}" aria-label="回复评论"><iconify-icon icon="material-symbols:comment-rounded" class="text-lg"></iconify-icon><span>${escapeHtml(String(replyCount))}</span></button>`
        : "";
    const menu = canDelete ? buildActionMenu(item.id, deleteLabel) : "";
    return `
    <div class="flex items-center gap-2 shrink-0">
      <button type="button" class="comment-action inline-flex h-8 items-center gap-1 text-sm font-medium ${likeClass} ${likePendingClass} hover:text-(--primary) transition-colors" data-action="like" data-id="${escapeHtml(item.id)}" aria-label="点赞评论" ${likePendingAttr}>
        <iconify-icon icon="material-symbols:thumb-up-rounded" class="text-lg"></iconify-icon>
        <span>${escapeHtml(String(likeCount))}</span>
      </button>
      ${replyButton}
      ${menu}
    </div>
  `;
}

function renderCommentBody(item: CommentItem): string {
    const bodyHtml = normalizeMarkdownHtml(item.body_html);
    if (bodyHtml) {
        return `<div class="prose prose-base dark:prose-invert !max-w-none custom-md text-90">${bodyHtml}</div>`;
    }
    return `<div class="text-sm leading-7 whitespace-pre-wrap break-words text-90">${escapeHtml(item.body || "")}</div>`;
}

export function renderCommentNodeInner(
    item: CommentItem,
    level: number,
    contentAuthorId: string,
    topLevelReplyExpandedMap: TopLevelReplyExpandState,
    currentUserId: string,
    isAdmin: boolean,
    pendingLikeCommentIds: Set<string>,
): string {
    const authorName = getAuthorName(item.author);
    const authorHref = getAuthorProfileHref(item.author);
    const isContentAuthor =
        Boolean(contentAuthorId) &&
        String(item.author_id || "").trim() === contentAuthorId;
    const avatar = buildAvatarHtml(item, authorHref);
    const authorNameHtml = buildAuthorNameHtml(authorName, authorHref);
    const authorBadgeHtml = isContentAuthor
        ? `<span class="inline-flex shrink-0 items-center rounded-md border border-(--line-divider) px-1.5 py-0.5 text-[11px] leading-none text-60">作者</span>`
        : "";
    const parentId = String(item.id || "").trim();
    const totalReplies = Array.isArray(item.replies) ? item.replies.length : 0;
    const { visibleReplies, hiddenCount, expanded } =
        getVisibleRepliesForRender(item, level, topLevelReplyExpandedMap);
    const canToggleReplies = isTopLevelReplyToggleTarget(level, totalReplies);
    const childClass = level > 0 ? "comment-node-child" : "";
    const repliesContainerId = parentId
        ? `comment-replies-${escapeHtml(parentId)}`
        : "";
    const toggleButtonHtml = buildToggleButtonHtml(
        canToggleReplies,
        parentId,
        expanded,
        hiddenCount,
        repliesContainerId,
    );
    const actions = renderCommentActions(
        item,
        level,
        currentUserId,
        isAdmin,
        pendingLikeCommentIds,
    );
    const childrenHtml = visibleReplies
        .map((reply) =>
            renderCommentNodeInner(
                reply,
                level + 1,
                contentAuthorId,
                topLevelReplyExpandedMap,
                currentUserId,
                isAdmin,
                pendingLikeCommentIds,
            ),
        )
        .join("");
    return `
    <div class="comment-node ${childClass}" data-comment-id="${escapeHtml(item.id)}">
      <div class="rounded-xl border border-(--line-divider) p-4 space-y-3 text-90">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            ${avatar}
            <div class="min-w-0">
              <div class="text-sm font-medium flex items-center gap-2 min-w-0">${authorNameHtml}${authorBadgeHtml}</div>
              <div class="text-xs text-60">${escapeHtml(formatDate(item.date_created))}</div>
            </div>
          </div>
          ${actions}
        </div>
        ${renderCommentBody(item)}
      </div>
      <div id="${repliesContainerId}" class="space-y-2">${childrenHtml}</div>
      ${toggleButtonHtml}
    </div>
  `;
}
