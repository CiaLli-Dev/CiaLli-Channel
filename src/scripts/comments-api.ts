import type { AuthState } from "@/scripts/auth-state";

export type ProgressOverlay = {
    startTask: (opts: Record<string, unknown>) => number;
    updateTask: (handle: number, stage: Record<string, unknown>) => void;
    finishTask: (handle: number) => void;
};

export type RuntimeWindow = Window &
    typeof globalThis & {
        _directusCommentAuthSubscribed?: boolean;
        _directusCommentApplyAuth?: (state: AuthState) => void;
        _directusCommentMenuOutsideBound?: boolean;
        _directusCommentOverlayPortalEl?: HTMLDivElement;
        _directusCommentNearObserver?: IntersectionObserver;
        renderMermaidDiagrams?: () => Promise<void>;
        codeBlockCollapser?: {
            setupCodeBlocks?: () => void;
            toggleCollapse?: (element: Element) => void;
        };
        __CIALLI_PROGRESS_OVERLAY__?: ProgressOverlay;
    };

export function buildCommentApiBase(
    moduleName: string,
    contentId: string,
): string {
    if (moduleName === "diaries") {
        return `/api/v1/diaries/${encodeURIComponent(contentId)}/comments`;
    }
    return `/api/v1/articles/${encodeURIComponent(contentId)}/comments`;
}

export function buildCommentApiListUrl(
    base: string,
    page: number,
    commentPageSize: number,
): string {
    const normalizedPage = Math.max(1, Math.floor(page || 1));
    const query = new URLSearchParams({
        page: String(normalizedPage),
        limit: String(commentPageSize),
    });
    return `${base}?${query.toString()}`;
}

export function buildCommentItemApi(
    moduleName: string,
    commentId: string,
): string {
    if (moduleName === "diaries") {
        return `/api/v1/diaries/comments/${encodeURIComponent(commentId)}`;
    }
    return `/api/v1/articles/comments/${encodeURIComponent(commentId)}`;
}

export function buildCommentPreviewApi(moduleName: string): string {
    if (moduleName === "diaries") {
        return "/api/v1/diaries/comments/preview";
    }
    return "/api/v1/articles/comments/preview";
}

export function buildCommentLikeApi(moduleName: string): string {
    if (moduleName === "diaries") {
        return "/api/v1/me/diary-comment-likes";
    }
    return "/api/v1/me/article-comment-likes";
}

export function buildCommentLikePayload(
    moduleName: string,
    commentId: string,
): Record<string, string> {
    if (moduleName === "diaries") {
        return { diary_comment_id: commentId };
    }
    return { article_comment_id: commentId };
}
