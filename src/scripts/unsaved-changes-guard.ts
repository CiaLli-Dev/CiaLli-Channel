/* eslint-disable max-lines-per-function -- 未保存导航协调器需集中处理 click、popstate 与程序化导航三个入口。 */
import { navigate } from "astro:transitions/client";
import { showUnsavedChangesDialog } from "@/scripts/dialogs";
import {
    getHistoryStateIndex,
    getPopstateRollbackDelta,
    isModifiedPrimaryClick,
    isSameDocumentHashNavigation,
    shouldIgnoreAnchorNavigation,
} from "@/scripts/unsaved-changes-guard-helpers";

type UnsavedChangesProgrammaticNavigation = {
    replace?: boolean;
    force?: boolean;
    commit: () => void;
    fallbackCommit: () => void;
};

type UnsavedChangesGuardOptions = {
    isDirty: () => boolean;
    getConfirmMessage: () => string;
    saveBeforeLeave: () => Promise<boolean>;
};

type GuardedNavigationRequest = {
    targetUrl: string;
    continueNavigation: () => void;
    cancelNavigation?: () => void;
};

type RuntimeWindow = Window &
    typeof globalThis & {
        __cialliUnsavedChangesHandleNavigation?: (
            targetUrl: string,
            request: UnsavedChangesProgrammaticNavigation,
        ) => boolean;
        __cialliUnsavedNavigationCanceledAt?: number;
    };

function dispatchUnsavedNavigationCancel(runtimeWindow: RuntimeWindow): void {
    runtimeWindow.__cialliUnsavedNavigationCanceledAt = Date.now();
    document.dispatchEvent(new CustomEvent("cialli:unsaved-navigation-cancel"));
}

function resolveAnchorTarget(
    eventTarget: EventTarget | null,
): HTMLAnchorElement | null {
    if (!(eventTarget instanceof Element)) {
        return null;
    }
    return eventTarget.closest<HTMLAnchorElement>("a[href]");
}

/**
 * 编辑页未保存拦截（客户端协调模式）：
 * 1) 保留 ClientRouter，避免站内跳转退化为整页重载。
 * 2) 在站内链接、程序化导航、浏览器前进后退时统一弹出“保存并离开 / 直接离开 / 取消”。
 * 3) 仅在真正整页卸载时回退到浏览器原生 beforeunload 提示。
 */
export function setupUnsavedChangesGuard(
    options: UnsavedChangesGuardOptions,
): () => void {
    const controller = new AbortController();
    const runtimeWindow = window as RuntimeWindow;
    const previousNavigationHandler =
        runtimeWindow.__cialliUnsavedChangesHandleNavigation;

    let currentHistoryIndex = getHistoryStateIndex(history.state);
    let decisionPending = false;
    let allowNextPopState = false;
    let suppressNextPopState = false;
    let skipNextBeforeUnload = false;

    const isDirtySafely = (): boolean => {
        try {
            return options.isDirty();
        } catch (error) {
            // 脏状态判断异常时按“有改动”处理，防止漏拦截。
            console.error("[unsaved-guard] isDirty failed:", error);
            return true;
        }
    };

    const runFullPageNavigation = (navigate: () => void): void => {
        skipNextBeforeUnload = true;
        navigate();
    };

    const continueProgrammaticNavigation = (
        request: UnsavedChangesProgrammaticNavigation,
    ): void => {
        if (request.force) {
            runFullPageNavigation(request.fallbackCommit);
            return;
        }
        request.commit();
    };

    const continueAnchorNavigation = (
        anchor: HTMLAnchorElement,
        targetUrl: URL,
    ): void => {
        const isSameOrigin = targetUrl.origin === window.location.origin;
        const shouldClientNavigate =
            isSameOrigin && anchor.dataset.astroReload === undefined;

        if (shouldClientNavigate) {
            try {
                navigate(targetUrl.href, {
                    history:
                        anchor.dataset.astroHistory === "replace"
                            ? "replace"
                            : "auto",
                });
            } catch (error) {
                console.error(
                    "[unsaved-guard] Astro navigation failed, fallback to location:",
                    error,
                );
                runFullPageNavigation(() => {
                    window.location.href = targetUrl.href;
                });
            }
            return;
        }

        if (anchor.dataset.astroHistory === "replace") {
            runFullPageNavigation(() => {
                window.location.replace(targetUrl.href);
            });
            return;
        }

        runFullPageNavigation(() => {
            window.location.href = targetUrl.href;
        });
    };

    const resolveNavigationDecision = async (
        request: GuardedNavigationRequest,
    ): Promise<void> => {
        if (decisionPending) {
            request.cancelNavigation?.();
            return;
        }
        decisionPending = true;

        try {
            const action = await showUnsavedChangesDialog();
            if (action === "cancel") {
                request.cancelNavigation?.();
                dispatchUnsavedNavigationCancel(runtimeWindow);
                return;
            }

            if (action === "save") {
                const saved = await options.saveBeforeLeave().catch((error) => {
                    console.error(
                        "[unsaved-guard] saveBeforeLeave failed:",
                        error,
                    );
                    return false;
                });
                if (!saved) {
                    request.cancelNavigation?.();
                    dispatchUnsavedNavigationCancel(runtimeWindow);
                    return;
                }
            }

            request.continueNavigation();
        } finally {
            decisionPending = false;
        }
    };

    const handleWindowClick = (event: MouseEvent): void => {
        const anchor = resolveAnchorTarget(event.target);
        if (!anchor) {
            return;
        }

        if (
            event.defaultPrevented ||
            isModifiedPrimaryClick(event) ||
            shouldIgnoreAnchorNavigation({
                hasDownload: anchor.hasAttribute("download"),
                target: String(anchor.getAttribute("target") || "").trim(),
            })
        ) {
            return;
        }

        const rawHref = anchor.getAttribute("href");
        if (!rawHref) {
            return;
        }

        let targetUrl: URL;
        try {
            targetUrl = new URL(rawHref, window.location.href);
        } catch {
            return;
        }

        if (
            isSameDocumentHashNavigation(window.location.href, targetUrl.href)
        ) {
            return;
        }

        if (!isDirtySafely()) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        void resolveNavigationDecision({
            targetUrl: targetUrl.href,
            continueNavigation: () => {
                continueAnchorNavigation(anchor, targetUrl);
            },
        });
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
        if (skipNextBeforeUnload) {
            skipNextBeforeUnload = false;
            return;
        }
        if (!isDirtySafely()) {
            return;
        }
        event.preventDefault();
        Reflect.set(event, "returnValue", options.getConfirmMessage());
    };

    const handlePopState = (event: PopStateEvent): void => {
        if (suppressNextPopState) {
            suppressNextPopState = false;
            currentHistoryIndex = getHistoryStateIndex(event.state);
            return;
        }

        if (allowNextPopState) {
            allowNextPopState = false;
            return;
        }

        if (!isDirtySafely()) {
            return;
        }

        const nextHistoryIndex = getHistoryStateIndex(event.state);
        if (nextHistoryIndex === null || currentHistoryIndex === null) {
            return;
        }

        const rollbackDelta = getPopstateRollbackDelta(
            currentHistoryIndex,
            nextHistoryIndex,
        );
        if (rollbackDelta === null) {
            return;
        }
        const targetUrl = window.location.href;

        event.stopImmediatePropagation();

        void resolveNavigationDecision({
            targetUrl,
            continueNavigation: () => {
                allowNextPopState = true;
                window.dispatchEvent(
                    new PopStateEvent("popstate", { state: history.state }),
                );
            },
            cancelNavigation: () => {
                suppressNextPopState = true;
                history.go(rollbackDelta);
            },
        });
    };

    const handleHistoryStateCommitted = (): void => {
        currentHistoryIndex = getHistoryStateIndex(history.state);
    };

    const handleProgrammaticNavigation = (
        targetUrl: string,
        request: UnsavedChangesProgrammaticNavigation,
    ): boolean => {
        if (!isDirtySafely()) {
            return typeof previousNavigationHandler === "function"
                ? previousNavigationHandler(targetUrl, request)
                : false;
        }

        void resolveNavigationDecision({
            targetUrl,
            continueNavigation: () => {
                continueProgrammaticNavigation(request);
            },
        });
        return true;
    };
    runtimeWindow.__cialliUnsavedChangesHandleNavigation =
        handleProgrammaticNavigation;

    window.addEventListener("click", handleWindowClick, {
        capture: true,
        signal: controller.signal,
    });
    window.addEventListener("beforeunload", handleBeforeUnload, {
        signal: controller.signal,
    });
    window.addEventListener("popstate", handlePopState, {
        capture: true,
        signal: controller.signal,
    });
    document.addEventListener("astro:page-load", handleHistoryStateCommitted, {
        signal: controller.signal,
    });
    window.addEventListener("pageshow", handleHistoryStateCommitted, {
        signal: controller.signal,
    });

    return () => {
        controller.abort();
        if (
            runtimeWindow.__cialliUnsavedChangesHandleNavigation ===
            handleProgrammaticNavigation
        ) {
            runtimeWindow.__cialliUnsavedChangesHandleNavigation =
                previousNavigationHandler;
        }
    };
}
