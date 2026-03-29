import { showConfirmDialog, showNoticeDialog } from "@/scripts/dialogs";
import { navigateToPage } from "@/utils/navigation-utils";
import { getCsrfToken } from "@/utils/csrf";

export type DetailElements = {
    likeBtn: HTMLButtonElement | null;
    commentBtn: HTMLButtonElement | null;
    commentEntryBtn: HTMLButtonElement | null;
    shareBtn: HTMLButtonElement | null;
    manageBtn: HTMLButtonElement | null;
    panel: HTMLElement | null;
    editBtn: HTMLButtonElement | null;
    deleteBtn: HTMLButtonElement | null;
    likeCountText: HTMLElement | null;
};

export type DetailMountContext = {
    rootEl: HTMLElement;
    dockToBackTop: boolean;
};

export function queryDetailElements(rootEl: HTMLElement): DetailElements {
    return {
        likeBtn: rootEl.querySelector<HTMLButtonElement>(".detail-like-btn"),
        commentBtn: rootEl.querySelector<HTMLButtonElement>(
            ".detail-comment-btn",
        ),
        commentEntryBtn: rootEl.querySelector<HTMLButtonElement>(
            ".detail-mobile-comment-entry",
        ),
        shareBtn: rootEl.querySelector<HTMLButtonElement>(".detail-share-btn"),
        manageBtn: rootEl.querySelector<HTMLButtonElement>(
            ".detail-manage-toggle",
        ),
        panel: rootEl.querySelector<HTMLElement>(".detail-manage-panel"),
        editBtn: rootEl.querySelector<HTMLButtonElement>(".detail-manage-edit"),
        deleteBtn: rootEl.querySelector<HTMLButtonElement>(
            ".detail-manage-delete",
        ),
        likeCountText: rootEl.querySelector<HTMLElement>(
            "[data-like-count-text]",
        ),
    };
}

function isElementVisible(el: HTMLElement): boolean {
    return window.getComputedStyle(el).display !== "none";
}

function resolveSidebarMountTarget(): HTMLElement | null {
    const rightSidebarSlot = document.getElementById("right-sidebar-slot");
    const tocWrapper = document.querySelector<HTMLElement>(
        "#right-sidebar-slot #toc-wrapper",
    );
    const tocRoot = document.querySelector<HTMLElement>(
        "#right-sidebar-slot #toc",
    );
    return tocWrapper ?? tocRoot?.parentElement ?? rightSidebarSlot ?? null;
}

function tryMountToCustomSlot(rootEl: HTMLElement): boolean {
    const customSlot = document.querySelector<HTMLElement>(
        "[data-detail-float-slot]",
    );
    if (!(customSlot instanceof HTMLElement) || !isElementVisible(customSlot)) {
        return false;
    }
    if (rootEl.parentElement !== customSlot) {
        customSlot.appendChild(rootEl);
    }
    return true;
}

function tryMountToSidebar(rootEl: HTMLElement): boolean {
    const mountTarget = resolveSidebarMountTarget();
    if (
        !(mountTarget instanceof HTMLElement) ||
        !isElementVisible(mountTarget)
    ) {
        return false;
    }
    if (rootEl.parentElement !== mountTarget) {
        mountTarget.appendChild(rootEl);
    }
    return true;
}

export function mountToFloatingAnchor(rootEl: HTMLElement): void {
    const dockAnchor = document.getElementById("detail-action-float-anchor");
    const canMount =
        dockAnchor instanceof HTMLElement && isElementVisible(dockAnchor);

    if (canMount && rootEl.parentElement !== dockAnchor) {
        dockAnchor.appendChild(rootEl);
        return;
    }
    if (!canMount && rootEl.parentElement !== document.body) {
        document.body.appendChild(rootEl);
    }
}

export function resolveAndMountElement(ctx: DetailMountContext): void {
    const { rootEl, dockToBackTop } = ctx;

    if (dockToBackTop) {
        mountToFloatingAnchor(rootEl);
        rootEl.classList.remove("slot-mode");
        rootEl.classList.add("fixed-mode");
        return;
    }

    const mountedToCustomSlot = tryMountToCustomSlot(rootEl);
    if (mountedToCustomSlot) {
        rootEl.classList.add("slot-mode");
        rootEl.classList.remove("fixed-mode");
        return;
    }

    const mountedToSidebar = tryMountToSidebar(rootEl);
    rootEl.classList.remove("slot-mode");
    rootEl.classList.toggle("fixed-mode", !mountedToSidebar);
}

export type DeleteActionContext = {
    mode: "owner" | "admin";
    ownerDeleteEndpoint: string;
    adminDeleteEndpoint?: string;
    ownerDeleteConfirmMessage: string;
    adminDeleteConfirmMessage?: string;
    deleteSuccessHref: string;
    contentType: string;
    deleteBtn: HTMLButtonElement;
    closePanel: () => void;
};

async function executeDeleteRequest(
    deleteEndpoint: string,
    deleteSuccessHref: string,
): Promise<void> {
    const response = await fetch(deleteEndpoint, {
        method: "DELETE",
        credentials: "include",
        headers: {
            Accept: "application/json",
            "x-csrf-token": getCsrfToken(),
        },
    });
    const data = (await response.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;
    if (!response.ok || !data?.ok) {
        const errMsg = (data?.error as Record<string, unknown> | undefined)
            ?.message;
        await showNoticeDialog({
            ariaLabel: "删除失败",
            message: typeof errMsg === "string" ? errMsg : "删除失败",
        });
        return;
    }
    navigateToPage(deleteSuccessHref || "/");
}

export async function handleDeleteAction(
    ctx: DeleteActionContext,
): Promise<void> {
    const {
        mode,
        ownerDeleteEndpoint,
        adminDeleteEndpoint,
        ownerDeleteConfirmMessage,
        adminDeleteConfirmMessage,
        deleteSuccessHref,
        contentType,
        deleteBtn,
        closePanel,
    } = ctx;

    // 统一在 helper 内做删除链路选择，避免调用方遗漏管理员路径分支。
    const deleteEndpoint =
        mode === "admin"
            ? String(adminDeleteEndpoint || "").trim()
            : String(ownerDeleteEndpoint || "").trim();
    const deleteConfirmMessage =
        mode === "admin"
            ? String(adminDeleteConfirmMessage || "").trim() ||
              ownerDeleteConfirmMessage
            : ownerDeleteConfirmMessage;

    if (!deleteEndpoint) {
        return;
    }
    const confirmed = await showConfirmDialog({
        ariaLabel: "删除确认",
        message: deleteConfirmMessage,
        confirmText: "确认删除",
        cancelText: "取消",
        confirmVariant: "danger",
    });
    if (!confirmed) {
        closePanel();
        return;
    }

    deleteBtn.disabled = true;
    try {
        await executeDeleteRequest(deleteEndpoint, deleteSuccessHref);
    } catch (error) {
        console.error(`[detail-action] delete ${contentType} failed:`, error);
        await showNoticeDialog({
            ariaLabel: "删除失败",
            message: "删除失败，请稍后重试。",
        });
    } finally {
        deleteBtn.disabled = false;
        closePanel();
    }
}

export type LikeActionState = {
    liked: boolean;
    likeCount: number;
    likePending: boolean;
};

export type LikeActionContext = {
    contentType: string;
    contentId: string;
    likeBtn: HTMLButtonElement;
    likeCountText: HTMLElement | null;
    rootEl: HTMLElement;
    state: LikeActionState;
    applyLikeUI: () => void;
};

type LikeApiResult = {
    liked: boolean;
    like_count: number;
};

async function fetchLikeToggle(
    contentType: string,
    contentId: string,
): Promise<LikeApiResult> {
    const endpoint =
        contentType === "diary"
            ? "/api/v1/me/diary-likes"
            : "/api/v1/me/article-likes";
    const body =
        contentType === "diary"
            ? { diary_id: contentId }
            : { article_id: contentId };
    const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;
    if (!response.ok || !data?.ok) {
        const errMsg = (data?.error as Record<string, unknown> | undefined)
            ?.message;
        throw new Error(
            typeof errMsg === "string" ? errMsg : "点赞操作失败，请稍后重试。",
        );
    }
    return {
        liked: Boolean(data?.liked),
        like_count: Number(data?.like_count || 0),
    };
}

export async function handleLikeAction(ctx: LikeActionContext): Promise<void> {
    const { contentType, contentId, state, applyLikeUI } = ctx;

    const previousLiked = state.liked;
    const previousLikeCount = state.likeCount;
    state.liked = !previousLiked;
    state.likeCount = Math.max(0, previousLikeCount + (state.liked ? 1 : -1));

    state.likePending = true;
    applyLikeUI();
    try {
        const result = await fetchLikeToggle(contentType, contentId);
        state.liked = result.liked;
        state.likeCount = result.like_count;
        applyLikeUI();
    } catch (error) {
        console.error("[detail-action] like request failed:", error);
        state.liked = previousLiked;
        state.likeCount = previousLikeCount;
        applyLikeUI();
        await showNoticeDialog({
            ariaLabel: "点赞失败",
            message:
                error instanceof Error && error.message
                    ? error.message
                    : "点赞操作失败，请稍后重试。",
        });
    } finally {
        state.likePending = false;
        applyLikeUI();
    }
}
