import type { AuthState } from "@/scripts/auth-state";
import { setupCodeCopyDelegation } from "@/scripts/code-copy";
import { refreshGithubCards } from "@/scripts/github-card-runtime";
import type {
    CommentAuthor,
    CommentItem,
    CommentToolbarAction,
    CommentSortMode,
    TimeSortDirection,
    TopLevelReplyExpandState,
} from "@/scripts/comments-types";
import {
    TOOLBAR_ACTIONS,
    TOP_LEVEL_REPLY_VISIBLE_LIMIT,
    REPLY_COLLAPSE_SCOPE,
} from "@/scripts/comments-types";
import {
    buildSiteDateFormatContext,
    formatSiteDateTime,
} from "@/utils/date-utils";

// ---------- 纯工具函数 ----------

export function escapeHtml(raw: unknown): string {
    return String(raw || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function formatDate(iso: string | null | undefined): string {
    if (typeof window === "undefined") {
        return "";
    }
    const siteDateContext = buildSiteDateFormatContext(
        window.__CIALLI_RUNTIME_SETTINGS__,
    );
    return formatSiteDateTime(iso, siteDateContext);
}

export function getAuthorName(
    author: CommentAuthor | null | undefined,
): string {
    const displayName = String(author?.display_name || "").trim();
    if (displayName) return displayName;
    return String(author?.name || "").trim() || "匿名用户";
}

export function getAuthorProfileHref(
    author: CommentAuthor | null | undefined,
): string | null {
    const username = String(author?.username || "").trim();
    if (!username) return null;
    return `/${encodeURIComponent(username)}`;
}

export function isToolbarAction(value: string): value is CommentToolbarAction {
    return TOOLBAR_ACTIONS.has(value as CommentToolbarAction);
}

function hasHtmlTag(value: string): boolean {
    return /<[a-z][\w:-]*(\s[^>]*)?>/i.test(value);
}

function decodeHtmlEntities(value: string): string {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return String(textarea.value || "");
}

export function normalizeMarkdownHtml(raw: unknown): string {
    const source = String(raw || "").trim();
    if (!source) return "";
    if (hasHtmlTag(source)) return source;
    if (source.includes("&lt;") || source.includes("&#")) {
        const decoded = decodeHtmlEntities(source).trim();
        if (hasHtmlTag(decoded)) return decoded;
    }
    return source;
}

export function resolveBodyHtmlFromResponse(data: unknown): string {
    if (!data || typeof data !== "object") return "";
    const record = data as Record<string, unknown>;
    const item =
        record.item && typeof record.item === "object"
            ? (record.item as Record<string, unknown>)
            : null;
    return normalizeMarkdownHtml(record.body_html ?? item?.body_html ?? "");
}

export async function refreshMarkdownRuntime(
    runtimeWindow: Window & {
        renderMermaidDiagrams?: () => Promise<void>;
        codeBlockCollapser?: {
            setupCodeBlocks?: () => void;
            toggleCollapse?: (element: Element) => void;
        };
    },
): Promise<void> {
    setupCodeCopyDelegation();
    try {
        await refreshGithubCards();
    } catch (error) {
        console.warn("[comment] refresh github cards failed:", error);
    }
    if (typeof runtimeWindow.renderMermaidDiagrams === "function") {
        void runtimeWindow.renderMermaidDiagrams().catch((error) => {
            console.warn("[comment] refresh mermaid failed:", error);
        });
    }
}

export function collapseCommentCodeBlocks(
    root: HTMLElement,
    runtimeWindow: Window & {
        codeBlockCollapser?: {
            setupCodeBlocks?: () => void;
            toggleCollapse?: (element: Element) => void;
        };
    },
): void {
    runtimeWindow.codeBlockCollapser?.setupCodeBlocks?.();

    const collapseNow = (): void => {
        const commentCodeBlocks = root.querySelectorAll<HTMLElement>(
            ".expressive-code.collapsible",
        );
        commentCodeBlocks.forEach((block) => {
            if (block.dataset.commentDefaultCollapsed === "1") return;
            const isCollapsed = block.classList.contains("collapsed");
            if (!isCollapsed) {
                if (runtimeWindow.codeBlockCollapser?.toggleCollapse) {
                    runtimeWindow.codeBlockCollapser.toggleCollapse(block);
                } else {
                    block.classList.remove("expanded");
                    block.classList.add("collapsed");
                }
            }
            block.dataset.commentDefaultCollapsed = "1";
        });
    };

    requestAnimationFrame(() => {
        collapseNow();
        setTimeout(collapseNow, 80);
    });
}

// ---------- 排序相关 ----------

export function getCommentCreatedAtMs(item: CommentItem): number {
    const value = new Date(item.date_created || "1970-01-01").getTime();
    if (Number.isNaN(value)) return 0;
    return value;
}

export function getSortedCommentsForRender(
    items: CommentItem[],
    sortMode: CommentSortMode,
    timeSortDirection: TimeSortDirection,
): CommentItem[] {
    const indexedItems = items.map((item, index) => ({ item, index }));
    indexedItems.sort((left, right) => {
        if (sortMode === "created_at") {
            return sortByCreatedAt(left, right, timeSortDirection);
        }
        return sortByLikeCount(left, right);
    });
    return indexedItems.map((entry) => entry.item);
}

function sortByCreatedAt(
    left: { item: CommentItem; index: number },
    right: { item: CommentItem; index: number },
    timeSortDirection: TimeSortDirection,
): number {
    const leftTime = getCommentCreatedAtMs(left.item);
    const rightTime = getCommentCreatedAtMs(right.item);
    const byTime =
        timeSortDirection === "asc"
            ? leftTime - rightTime
            : rightTime - leftTime;
    if (byTime !== 0) return byTime;
    return left.index - right.index;
}

function sortByLikeCount(
    left: { item: CommentItem; index: number },
    right: { item: CommentItem; index: number },
): number {
    const byLikeCount =
        Math.max(0, Number(right.item.like_count || 0)) -
        Math.max(0, Number(left.item.like_count || 0));
    if (byLikeCount !== 0) return byLikeCount;
    const leftTime = getCommentCreatedAtMs(left.item);
    const rightTime = getCommentCreatedAtMs(right.item);
    const byTime = leftTime - rightTime;
    if (byTime !== 0) return byTime;
    return left.index - right.index;
}

// ---------- 回复折叠相关 ----------

export function isTopLevelReplyToggleTarget(
    level: number,
    repliesLength: number,
): boolean {
    return (
        REPLY_COLLAPSE_SCOPE === "top_level_only" &&
        level === 0 &&
        repliesLength > TOP_LEVEL_REPLY_VISIBLE_LIMIT
    );
}

export function getVisibleRepliesForRender(
    item: CommentItem,
    level: number,
    topLevelReplyExpandedMap: TopLevelReplyExpandState,
): { visibleReplies: CommentItem[]; hiddenCount: number; expanded: boolean } {
    const replies = Array.isArray(item.replies) ? item.replies : [];
    if (!isTopLevelReplyToggleTarget(level, replies.length)) {
        return { visibleReplies: replies, hiddenCount: 0, expanded: true };
    }
    const parentId = String(item.id || "").trim();
    if (!parentId) {
        return { visibleReplies: replies, hiddenCount: 0, expanded: true };
    }
    const expanded = Boolean(topLevelReplyExpandedMap[parentId]);
    if (expanded) {
        return { visibleReplies: replies, hiddenCount: 0, expanded: true };
    }
    return {
        visibleReplies: replies.slice(0, TOP_LEVEL_REPLY_VISIBLE_LIMIT),
        hiddenCount: Math.max(
            0,
            replies.length - TOP_LEVEL_REPLY_VISIBLE_LIMIT,
        ),
        expanded: false,
    };
}

export function syncTopLevelReplyExpandedState(
    items: CommentItem[],
    topLevelReplyExpandedMap: TopLevelReplyExpandState,
): TopLevelReplyExpandState {
    const expandableTopLevelIds = new Set<string>();
    for (const item of items) {
        const id = String(item.id || "").trim();
        const replies = Array.isArray(item.replies) ? item.replies : [];
        if (id && replies.length > TOP_LEVEL_REPLY_VISIBLE_LIMIT) {
            expandableTopLevelIds.add(id);
        }
    }
    const nextState: TopLevelReplyExpandState = {};
    for (const id of expandableTopLevelIds) {
        if (topLevelReplyExpandedMap[id]) {
            nextState[id] = true;
        }
    }
    return nextState;
}

export function appendTopLevelComments(
    source: CommentItem[],
    incoming: CommentItem[],
): CommentItem[] {
    if (source.length === 0) return incoming;
    const exists = new Set(source.map((item) => String(item.id || "").trim()));
    const next = [...source];
    for (const item of incoming) {
        const id = String(item.id || "").trim();
        if (!id || exists.has(id)) continue;
        exists.add(id);
        next.push(item);
    }
    return next;
}

// ---------- 点赞状态辅助 ----------

export function updateCommentLikeState(
    items: CommentItem[],
    commentId: string,
    liked: boolean,
    likeCount: number,
): boolean {
    for (const item of items) {
        if (item.id === commentId) {
            item.liked_by_viewer = liked;
            item.like_count = likeCount;
            return true;
        }
        const replies = Array.isArray(item.replies) ? item.replies : [];
        if (updateCommentLikeState(replies, commentId, liked, likeCount)) {
            return true;
        }
    }
    return false;
}

export function getCommentLikeSnapshot(
    items: CommentItem[],
    commentId: string,
): { liked: boolean; likeCount: number } | null {
    for (const item of items) {
        if (item.id === commentId) {
            return {
                liked: Boolean(item.liked_by_viewer),
                likeCount: Math.max(0, Number(item.like_count || 0)),
            };
        }
        const replies = Array.isArray(item.replies) ? item.replies : [];
        const nestedResult = getCommentLikeSnapshot(replies, commentId);
        if (nestedResult) return nestedResult;
    }
    return null;
}

// ---------- Toolbar 操作辅助 ----------

export function replaceSelection(
    textarea: HTMLTextAreaElement,
    replacement: string,
    selectionStartOffset: number,
    selectionEndOffset: number,
    onDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const source = textarea.value;
    const before = source.slice(0, start);
    const after = source.slice(end);
    textarea.value = `${before}${replacement}${after}`;
    const nextStart = before.length + selectionStartOffset;
    const nextEnd = before.length + selectionEndOffset;
    textarea.focus();
    textarea.setSelectionRange(nextStart, nextEnd);
    onDirty();
}

export function applyWrapAction(
    textarea: HTMLTextAreaElement,
    prefix: string,
    suffix: string,
    placeholder: string,
    onDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const content = selected || placeholder;
    const replacement = `${prefix}${content}${suffix}`;
    replaceSelection(
        textarea,
        replacement,
        prefix.length,
        prefix.length + content.length,
        onDirty,
    );
}

export function applyQuoteAction(
    textarea: HTMLTextAreaElement,
    onDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const source = selected || "引用内容";
    const quoted = source
        .replaceAll("\r\n", "\n")
        .split("\n")
        .map((line) => (line.startsWith("> ") ? line : `> ${line}`))
        .join("\n");
    replaceSelection(textarea, quoted, 0, quoted.length, onDirty);
}

export function applyCodeBlockAction(
    textarea: HTMLTextAreaElement,
    onDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const source = textarea.value;
    const selected = source.slice(start, end) || "代码内容";
    const language = "text";
    const block = `\`\`\`${language}\n${selected}\n\`\`\``;
    const needsLeadingBreak = start > 0 && source[start - 1] !== "\n";
    const needsTrailingBreak = end < source.length && source[end] !== "\n";
    const prefix = needsLeadingBreak ? "\n" : "";
    const suffix = needsTrailingBreak ? "\n" : "";
    const replacement = `${prefix}${block}${suffix}`;
    const contentStartOffset = prefix.length + `\`\`\`${language}\n`.length;
    const contentEndOffset = contentStartOffset + selected.length;
    replaceSelection(
        textarea,
        replacement,
        contentStartOffset,
        contentEndOffset,
        onDirty,
    );
}

// ---------- Auth 辅助 ----------

export function resolveUserFromAuthState(state: AuthState): {
    userId: string;
    isAdmin: boolean;
} {
    return {
        userId: state.isLoggedIn ? state.userId : "",
        isAdmin: state.isLoggedIn && state.isAdmin,
    };
}
