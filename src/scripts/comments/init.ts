import { getAuthState, subscribeAuthState } from "@/scripts/auth/state";
import type { AuthState } from "@/scripts/auth/state";
import { CommentController } from "@/scripts/comments/controller";
import type { RuntimeWindow } from "@/scripts/comments/api";

type CommentRuntimeWindow = Window &
    typeof globalThis & {
        _directusCommentAuthSubscribed?: boolean;
        _directusCommentApplyAuth?: (state: AuthState) => void;
        _directusCommentMenuOutsideBound?: boolean;
        _directusCommentMenuToggleBound?: boolean;
        _directusCommentNearObserver?: IntersectionObserver;
    };

const runtimeWindow = window as CommentRuntimeWindow;

export function initComments(): void {
    const root = document.getElementById("comment-root");
    if (!root) return;

    runtimeWindow._directusCommentNearObserver?.disconnect();
    runtimeWindow._directusCommentNearObserver = undefined;
    document.body.classList.remove("dc-comment-editor-overlay-lock");

    const controller = new CommentController(root, window as RuntimeWindow);

    controller.initOverlayPortal();
    controller.bindAllEvents();

    runtimeWindow._directusCommentApplyAuth = (state: AuthState): void => {
        controller.applyAuthState(state);
    };

    if (!runtimeWindow._directusCommentMenuOutsideBound) {
        runtimeWindow._directusCommentMenuOutsideBound = true;
        document.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                closeAllCommentActionMenus();
                return;
            }
            if (target.closest(".comment-action-menu")) return;
            closeAllCommentActionMenus();
        });
    }
    if (!runtimeWindow._directusCommentMenuToggleBound) {
        runtimeWindow._directusCommentMenuToggleBound = true;
        document.addEventListener(
            "toggle",
            (event) => {
                const target = event.target;
                if (!(target instanceof HTMLDetailsElement)) return;
                if (!target.classList.contains("comment-action-menu")) return;
                if (!target.open) return;
                // 仅保留当前打开的评论菜单，避免多个二级面板同时展开
                closeAllCommentActionMenus(target);
            },
            true,
        );
    }

    if (!runtimeWindow._directusCommentAuthSubscribed) {
        runtimeWindow._directusCommentAuthSubscribed = true;
        subscribeAuthState((state) => {
            runtimeWindow._directusCommentApplyAuth?.(state);
        });
    }

    const directusEnabled = root.dataset.directusEnabled === "1";
    if (!directusEnabled) return;

    controller.initUiState();
    controller.applyAuthState(getAuthState());
    controller.setupCommentLoadStrategy();
}

function closeAllCommentActionMenus(exceptMenu?: HTMLDetailsElement): void {
    const openedMenus = document.querySelectorAll<HTMLDetailsElement>(
        "details.comment-action-menu[open]",
    );
    openedMenus.forEach((menu) => {
        if (exceptMenu && menu === exceptMenu) {
            return;
        }
        menu.removeAttribute("open");
    });
}
