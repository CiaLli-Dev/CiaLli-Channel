import type { LayoutState } from "./layout-state";

export type LayoutDomAdapterDeps = {
    bannerHeight: number;
    bannerHeightHome: number;
    bannerHeightExtend: number;
    updateBannerCarouselState: () => void;
};

type LayoutDomRuntimeWindow = Window &
    typeof globalThis & {
        __layoutCollapseScrollAnimationId?: number;
        __layoutContentSoftTimeoutId?: number;
    };

const CONTENT_SOFT_COLLAPSE_CLASS = "layout-content-soft-collapse";
const CONTENT_SOFT_COLLAPSE_DURATION_MS = 220;
const MAIN_PANEL_TOP_NO_BANNER = "5.5rem";
const BANNER_TO_SPEC_TRANSITION_CLASS = "layout-banner-to-spec-transition";
const BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS =
    "layout-banner-to-spec-transition-preparing";
const BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS =
    "layout-banner-to-spec-transition-active";

function syncBodyState(next: LayoutState): void {
    const body = document.body;
    const isBannerMode = next.mode === "banner";

    body.dataset.layoutMode = next.mode;
    body.dataset.routeHome = String(next.isHome);

    // Legacy classes are preserved as compatibility layer for existing utility styles.
    body.classList.toggle("lg:is-home", next.isHome);
    body.classList.toggle("enable-banner", isBannerMode);
    body.classList.toggle("no-banner-mode", !isBannerMode);
    body.classList.toggle("waves-paused", !isBannerMode);
    body.classList.toggle("scroll-collapsed-banner", next.mode === "collapsed");
}

function resolveMainPanelTop(
    next: LayoutState,
    deps: LayoutDomAdapterDeps,
): string {
    if (next.mode === "banner") {
        return `${deps.bannerHeightHome}vh`;
    }
    return MAIN_PANEL_TOP_NO_BANNER;
}

function syncBannerAndMainPanel(
    next: LayoutState,
    deps: LayoutDomAdapterDeps,
): void {
    const isBannerMode = next.mode === "banner";
    const bannerWrapper = document.getElementById("banner-wrapper");
    const mainPanelWrapper = document.querySelector(
        ".main-panel-wrapper",
    ) as HTMLElement | null;

    if (bannerWrapper) {
        bannerWrapper.classList.toggle("wallpaper-layer-hidden", !isBannerMode);
        if (isBannerMode) {
            bannerWrapper.removeAttribute("aria-hidden");
            bannerWrapper.removeAttribute("inert");
            bannerWrapper.style.removeProperty("height");
        } else {
            bannerWrapper.setAttribute("aria-hidden", "true");
            bannerWrapper.setAttribute("inert", "");
        }
    }

    if (mainPanelWrapper) {
        mainPanelWrapper.classList.toggle("no-banner-layout", !isBannerMode);
        mainPanelWrapper.style.top = resolveMainPanelTop(next, deps);
    }
}

function syncNavbar(next: LayoutState): void {
    const navbar = document.getElementById("navbar");
    if (!navbar) {
        return;
    }

    navbar.setAttribute("data-is-home", String(next.isHome));
    const transparentMode =
        next.mode === "banner" ? next.navbarTransparentMode : "none";
    navbar.setAttribute("data-transparent-mode", transparentMode);
    navbar.removeAttribute("data-dynamic-transparent");

    const root = document.documentElement;
    const shouldLockScrolledState =
        root.classList.contains(BANNER_TO_SPEC_TRANSITION_CLASS) ||
        root.classList.contains(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS) ||
        root.classList.contains(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
    if (shouldLockScrolledState) {
        // 过渡窗口期由 transition-hooks 统一控制 navbar.scrolled，避免中途抖动。
        return;
    }

    const shouldBeScrolled =
        next.mode === "banner" &&
        next.navbarTransparentMode === "semifull" &&
        next.scrollTop > 50;
    navbar.classList.toggle("scrolled", shouldBeScrolled);
}

function syncToc(next: LayoutState, deps: LayoutDomAdapterDeps): void {
    const tocWrapper = document.getElementById("toc-wrapper");
    if (!tocWrapper) {
        return;
    }

    if (next.mode !== "banner") {
        tocWrapper.classList.remove("toc-hide");
        return;
    }

    const thresholdBase = next.isHome
        ? deps.bannerHeightHome
        : deps.bannerHeight;
    const threshold = window.innerHeight * (thresholdBase / 100);
    tocWrapper.classList.toggle("toc-hide", next.scrollTop <= threshold);
}

function getCollapseTargetScroll(
    currentScroll: number,
    deps: LayoutDomAdapterDeps,
): number {
    const bannerHeightPx = window.innerHeight * (deps.bannerHeight / 100);
    const bannerHeightExtendPx = Math.floor(
        window.innerHeight * (deps.bannerHeightExtend / 100),
    );
    const delta = bannerHeightPx + bannerHeightExtendPx - 88;
    return Math.max(0, currentScroll - delta);
}

function getContentWrapperViewportTop(): number | null {
    const contentWrapper = document.getElementById("content-wrapper");
    if (!(contentWrapper instanceof HTMLElement)) {
        return null;
    }
    return contentWrapper.getBoundingClientRect().top;
}

function compensateScrollForCollapse(
    deps: LayoutDomAdapterDeps,
    contentTopBeforeCollapse: number | null,
): void {
    const documentRoot = document.documentElement;
    const currentScroll = documentRoot.scrollTop;
    let targetScroll = getCollapseTargetScroll(currentScroll, deps);

    // Prefer geometry-based compensation so layout top differences
    // don't cause a snap.
    const contentTopAfterCollapse = getContentWrapperViewportTop();
    if (contentTopBeforeCollapse !== null && contentTopAfterCollapse !== null) {
        targetScroll = Math.max(
            0,
            currentScroll +
                (contentTopAfterCollapse - contentTopBeforeCollapse),
        );
    }

    const scrollDistance = targetScroll - currentScroll;

    if (Math.abs(scrollDistance) < 1) {
        return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        window.scrollTo({ top: targetScroll, behavior: "instant" });
        return;
    }

    const runtimeWindow = window as LayoutDomRuntimeWindow;
    if (runtimeWindow.__layoutCollapseScrollAnimationId !== undefined) {
        cancelAnimationFrame(runtimeWindow.__layoutCollapseScrollAnimationId);
        runtimeWindow.__layoutCollapseScrollAnimationId = undefined;
    }

    // Apply one-shot compensation to avoid any trailing "snap" animation
    // on the article list while entering collapsed mode.
    window.scrollTo({ top: targetScroll, behavior: "instant" });
}

function isViewTransitioning(): boolean {
    const html = document.documentElement;
    return (
        html.classList.contains("is-changing") ||
        html.classList.contains("is-animating")
    );
}

function clearContentSoftCollapseAnimation(
    runtimeWindow: LayoutDomRuntimeWindow,
): void {
    if (runtimeWindow.__layoutContentSoftTimeoutId !== undefined) {
        window.clearTimeout(runtimeWindow.__layoutContentSoftTimeoutId);
        runtimeWindow.__layoutContentSoftTimeoutId = undefined;
    }
    document.body.classList.remove(CONTENT_SOFT_COLLAPSE_CLASS);
}

function triggerContentSoftCollapseAnimation(
    runtimeWindow: LayoutDomRuntimeWindow,
): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    clearContentSoftCollapseAnimation(runtimeWindow);
    // Force reflow so quick re-entry can replay the animation.
    void document.body.offsetHeight;
    document.body.classList.add(CONTENT_SOFT_COLLAPSE_CLASS);

    runtimeWindow.__layoutContentSoftTimeoutId = window.setTimeout(() => {
        document.body.classList.remove(CONTENT_SOFT_COLLAPSE_CLASS);
        runtimeWindow.__layoutContentSoftTimeoutId = undefined;
    }, CONTENT_SOFT_COLLAPSE_DURATION_MS + 40);
}

function shouldRestoreTopOnExpand(
    prev: LayoutState | null,
    next: LayoutState,
): boolean {
    return (
        prev?.mode === "collapsed" &&
        next.mode === "banner" &&
        next.reason === "logo-click"
    );
}

export function applyLayoutState(
    prev: LayoutState | null,
    next: LayoutState,
    deps: LayoutDomAdapterDeps,
): void {
    const runtimeWindow = window as LayoutDomRuntimeWindow;
    if (
        next.mode !== "collapsed" &&
        runtimeWindow.__layoutCollapseScrollAnimationId !== undefined
    ) {
        cancelAnimationFrame(runtimeWindow.__layoutCollapseScrollAnimationId);
        runtimeWindow.__layoutCollapseScrollAnimationId = undefined;
    }
    if (next.mode !== "collapsed") {
        clearContentSoftCollapseAnimation(runtimeWindow);
    }

    const collapsingFromBanner =
        prev?.mode === "banner" && next.mode === "collapsed";
    const contentTopBeforeCollapse = collapsingFromBanner
        ? getContentWrapperViewportTop()
        : null;

    syncBodyState(next);
    syncBannerAndMainPanel(next, deps);
    syncNavbar(next);
    syncToc(next, deps);

    if (collapsingFromBanner && !isViewTransitioning()) {
        compensateScrollForCollapse(deps, contentTopBeforeCollapse);
        triggerContentSoftCollapseAnimation(runtimeWindow);
    }

    if (shouldRestoreTopOnExpand(prev, next)) {
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }

    requestAnimationFrame(() => {
        deps.updateBannerCarouselState();
    });
}
