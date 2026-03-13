import type { LayoutController } from "./layout-controller";
import { getTocBaselineOffset } from "@/utils/toc-offset";

type ScrollIntentSourceOptions = {
    controller: LayoutController;
    bannerHeight: number;
    bannerHeightHome: number;
    bannerHeightExtend: number;
};

const LAYOUT_TRANSITION_FREEZE_CLASSES = [
    "layout-banner-to-spec-transition",
    "layout-banner-to-spec-transition-preparing",
    "layout-banner-to-spec-transition-active",
    "layout-spec-to-banner-transition",
    "layout-banner-to-spec-navbar-commit-freeze",
] as const;

function isLayoutTransitionRunning(): boolean {
    const root = document.documentElement;
    // 过渡窗口期冻结滚动意图，避免 SCROLL_UPDATE 与路由提交阶段互相抢写
    return LAYOUT_TRANSITION_FREEZE_CLASSES.some((className) =>
        root.classList.contains(className),
    );
}

function throttle(func: () => void, limit: number): () => void {
    let inThrottle = false;
    return () => {
        if (inThrottle) {
            return;
        }
        func();
        inThrottle = true;
        window.setTimeout(() => {
            inThrottle = false;
        }, limit);
    };
}

function updateBackToTopButton(
    backToTopBtn: HTMLElement | null,
    bannerHeight: number,
): void {
    if (!backToTopBtn) {
        return;
    }

    const scrollTop = document.documentElement.scrollTop;
    const bannerHeightPx = window.innerHeight * (bannerHeight / 100);
    const contentWrapper = document.getElementById("content-wrapper");
    let showBackToTopThreshold = bannerHeightPx + 100;

    if (contentWrapper) {
        const rect = contentWrapper.getBoundingClientRect();
        const absoluteTop = rect.top + scrollTop;
        showBackToTopThreshold = absoluteTop + window.innerHeight / 4;
    }

    if (scrollTop > showBackToTopThreshold) {
        backToTopBtn.classList.remove("hide");
    } else {
        backToTopBtn.classList.add("hide");
    }
}

function resolveBackToTopButton(
    currentButton: HTMLElement | null,
): HTMLElement | null {
    if (currentButton && currentButton.isConnected) {
        return currentButton;
    }

    return document.getElementById("back-to-top-btn");
}

function updateBannerExtendCssVar(bannerHeightExtend: number): void {
    let offset = Math.floor(window.innerHeight * (bannerHeightExtend / 100));
    offset = offset - (offset % 4);
    document.documentElement.style.setProperty(
        "--banner-height-extend",
        `${offset}px`,
    );
}

function getCollapseScrollThreshold(
    scrollTop: number,
    bannerHeightHome: number,
): number {
    // Reuse TOC/hash-scroll baseline model so collapse timing follows
    // real navbar height instead of a fixed magic number.
    const baselineOffset = getTocBaselineOffset();
    const contentWrapper = document.getElementById("content-wrapper");

    if (contentWrapper) {
        const rect = contentWrapper.getBoundingClientRect();
        const absoluteTop = rect.top + scrollTop;
        return Math.max(0, absoluteTop - baselineOffset);
    }

    const fallbackTop = window.innerHeight * (bannerHeightHome / 100);
    return Math.max(0, fallbackTop - baselineOffset);
}

export function setupScrollIntentSource(
    options: ScrollIntentSourceOptions,
): () => void {
    let backToTopBtn = document.getElementById("back-to-top-btn");

    const handleScroll = () => {
        const scrollTop = document.documentElement.scrollTop;
        const viewportWidth = window.innerWidth;
        const shouldFreezeCollapseIntent = isLayoutTransitionRunning();
        const currentState = shouldFreezeCollapseIntent
            ? options.controller.getState()
            : options.controller.dispatch({
                  type: "SCROLL_UPDATE",
                  scrollTop,
                  viewportWidth,
              });

        requestAnimationFrame(() => {
            backToTopBtn = resolveBackToTopButton(backToTopBtn);
            updateBackToTopButton(backToTopBtn, options.bannerHeight);

            if (shouldFreezeCollapseIntent) {
                return;
            }

            if (
                currentState.mode === "banner" &&
                currentState.isHome &&
                viewportWidth >= 1280
            ) {
                const threshold = getCollapseScrollThreshold(
                    scrollTop,
                    options.bannerHeightHome,
                );
                if (scrollTop >= threshold) {
                    options.controller.dispatch({
                        type: "COLLAPSE_BANNER",
                        reason: "scroll-collapse",
                    });
                }
            }
        });
    };

    const handleResize = () => {
        options.controller.dispatch({
            type: "RESIZE",
            scrollTop: document.documentElement.scrollTop,
            viewportWidth: window.innerWidth,
        });
        updateBannerExtendCssVar(options.bannerHeightExtend);
    };

    const throttledScroll = throttle(handleScroll, 16);
    window.addEventListener("scroll", throttledScroll, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });

    updateBannerExtendCssVar(options.bannerHeightExtend);
    handleScroll();

    return () => {
        window.removeEventListener("scroll", throttledScroll);
        window.removeEventListener("resize", handleResize);
    };
}
