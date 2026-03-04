import type { LayoutController } from "./layout-controller";
import {
    applySidebarProfilePatch,
    syncSidebarAvatarLoadingState,
} from "./sidebar-profile-sync";
import {
    activateEnterSkeleton,
    deactivateEnterSkeleton,
    forceResetEnterSkeleton,
} from "./enter-skeleton";
import { scrollToHashBelowTocBaseline } from "@/utils/hash-scroll";
import {
    isCurrentHomeRoute,
    normalizePathname,
    isSameNavigationTarget,
    stripOnloadAnimationClasses,
    setBannerToSpecViewTransitionNames,
    freezeSpecLayoutStateForHomeDocument,
    applyBannerToSpecShiftVariables,
    syncRootRuntimeStateToIncomingDocument,
    setPageHeightExtendVisible,
    setAwaitingReplaceState,
    resolveSidebarPreservation,
    clearDelayedPageViewTimer,
    getBannerToSpecRemainingMs,
    clearBannerToSpecTransitionVisualState,
    startBannerToSpecMoveTransition,
    applyVtDurationFromElapsed,
    dispatchRouteChangeWithNavbarCommitFreeze,
    resolveExpectedThemeState,
    applyThemeStateToRoot,
    BANNER_TO_SPEC_TRANSITION_CLASS,
    BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS,
    SPEC_TO_BANNER_TRANSITION_CLASS,
    BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
    BANNER_TO_SPEC_TRANSITION_DURATION_MS,
    type TransitionState,
    type TransitionIntentDeps,
} from "./transition-layout-utils";

// Astro View Transitions event types
type BeforePreparationEvent = Event & {
    to: URL;
    from: URL;
    direction?: string;
    navigationType?: string;
};

type BeforeSwapEvent = Event & {
    newDocument: Document;
    swap: () => void;
};

type TransitionIntentSourceDependencies = {
    controller: LayoutController;
    initFancybox: () => Promise<void>;
    cleanupFancybox: () => void;
    checkKatex: () => void;
    initKatexScrollbars: () => void;
    defaultTheme: string;
    darkMode: string;
    pathsEqual: (left: string, right: string) => boolean;
    url: (path: string) => string;
};

type RuntimeWindowWithTOC = Window &
    typeof globalThis & {
        floatingTOCInit?: () => void;
        __cialliUnsavedNavigationCanceledAt?: number;
    };

// ===== Before-preparation helpers =====

function resetNavigationState(state: TransitionState): void {
    state.pendingBannerToSpecRoutePath = null;
    state.pendingSidebarProfilePatch = null;
    state.pendingSpecToBannerFreeze = false;
    state.bannerToSpecAnimationStartedAt = null;
}

function forceResetTransitionState(state: TransitionState): void {
    state.navigationInProgress = false;
    state.didReplaceContentDuringVisit = false;
    resetNavigationState(state);
    clearBannerToSpecTransitionVisualState(state);
    setAwaitingReplaceState(false);
    setPageHeightExtendVisible(false);
    forceResetEnterSkeleton();
}

function applyBannerToSpecTransitionSetup(
    state: TransitionState,
    targetPathname: string,
): void {
    state.pendingBannerToSpecRoutePath = targetPathname;
    const root = document.documentElement;
    applyBannerToSpecShiftVariables(undefined, root);
    root.style.setProperty(
        BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
        `${BANNER_TO_SPEC_TRANSITION_DURATION_MS}ms`,
    );
    root.classList.add(BANNER_TO_SPEC_TRANSITION_CLASS);
    root.classList.add(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
    setBannerToSpecViewTransitionNames(document);
    setPageHeightExtendVisible(true);
    void root.offsetHeight;
    startBannerToSpecMoveTransition(state);
}

// ===== Before-preparation event handler =====

function handleBeforePreparation(
    e: BeforePreparationEvent,
    state: TransitionState,
    deps: TransitionIntentSourceDependencies,
): void {
    const runtimeWindow = window as RuntimeWindowWithTOC;
    const canceledAt = runtimeWindow.__cialliUnsavedNavigationCanceledAt ?? 0;
    if (Date.now() - canceledAt <= 1800) {
        // 兜底：未保存拦截取消后若仍误触发准备阶段，直接复位并跳过骨架激活。
        forceResetTransitionState(state);
        return;
    }

    if (e.defaultPrevented) {
        // 若导航在其他监听器中已被取消，需立即复位过渡状态，防止骨架屏残留。
        forceResetTransitionState(state);
        return;
    }

    if (isSameNavigationTarget(e.from, e.to)) {
        state.navigationInProgress = false;
        state.didReplaceContentDuringVisit = false;
        resetNavigationState(state);
        clearBannerToSpecTransitionVisualState(state);
        setAwaitingReplaceState(false);
        setPageHeightExtendVisible(false);
        return;
    }

    const targetPathname = normalizePathname(e.to.pathname);
    state.navigationInProgress = true;
    state.didReplaceContentDuringVisit = false;
    forceResetEnterSkeleton();
    setAwaitingReplaceState(true);
    deps.cleanupFancybox();
    resetNavigationState(state);
    clearBannerToSpecTransitionVisualState(state);
    document.documentElement.style.setProperty("--content-delay", "0ms");

    const isTargetHome = deps.pathsEqual(targetPathname, deps.url("/"));
    const body = document.body;
    const currentPathname = normalizePathname(window.location.pathname);
    const currentIsHome =
        deps.pathsEqual(currentPathname, deps.url("/")) ||
        isCurrentHomeRoute(body);
    const hasBannerWrapper = document.getElementById("banner-wrapper");
    const shouldUseBannerToSpec =
        currentIsHome && hasBannerWrapper !== null && !isTargetHome;

    if (shouldUseBannerToSpec) {
        applyBannerToSpecTransitionSetup(state, targetPathname);
    } else {
        setPageHeightExtendVisible(false);
    }

    state.pendingSpecToBannerFreeze = !currentIsHome && isTargetHome;
    document.documentElement.classList.toggle(
        SPEC_TO_BANNER_TRANSITION_CLASS,
        state.pendingSpecToBannerFreeze,
    );

    const toc = document.getElementById("toc-wrapper");
    if (toc) {
        toc.classList.add("toc-not-ready");
    }

    activateEnterSkeleton();
}

// ===== Before-swap event handler =====

function handleBeforeSwap(
    e: BeforeSwapEvent,
    state: TransitionState,
    deps: TransitionIntentSourceDependencies,
): void {
    const newDocument = e.newDocument;

    const topRow = document.getElementById("top-row");
    if (topRow instanceof HTMLElement) {
        stripOnloadAnimationClasses(topRow);
    }

    syncRootRuntimeStateToIncomingDocument(
        newDocument,
        deps.defaultTheme,
        deps.darkMode,
    );

    state.pendingSidebarProfilePatch = null;
    const currentSidebar = document.querySelector<HTMLElement>("#sidebar");
    const newSidebar = newDocument.querySelector<HTMLElement>("#sidebar");
    let shouldPreserveSidebar = false;

    if (currentSidebar && newSidebar) {
        const result = resolveSidebarPreservation(currentSidebar, newSidebar);
        shouldPreserveSidebar = result.shouldPreserveSidebar;
        state.pendingSidebarProfilePatch = result.patch;
    }

    const newMainGrid = newDocument.querySelector("#main-grid");
    const currentMainGrid = document.getElementById("main-grid");
    if (newMainGrid instanceof HTMLElement && currentMainGrid) {
        currentMainGrid.className = newMainGrid.className;
    }

    if (
        state.pendingBannerToSpecRoutePath &&
        state.bannerToSpecAnimationStartedAt === null
    ) {
        applyBannerToSpecShiftVariables(newDocument);
    }

    applyVtDurationFromElapsed(state, newDocument);

    const savedSidebar = shouldPreserveSidebar
        ? document.querySelector<HTMLElement>("#sidebar")
        : null;
    const savedScrollY = window.scrollY;
    const suppressScroll = Boolean(state.pendingBannerToSpecRoutePath);
    const capturedBannerPath = state.pendingBannerToSpecRoutePath;
    const capturedSpecFreeze = state.pendingSpecToBannerFreeze;

    const originalSwap = e.swap;
    e.swap = () => {
        originalSwap();
        if (savedSidebar) {
            const inDom = document.querySelector("#sidebar");
            if (inDom) {
                inDom.replaceWith(savedSidebar);
            }
        }
        if (suppressScroll) {
            window.scrollTo(0, savedScrollY);
        }
        if (capturedBannerPath) {
            setBannerToSpecViewTransitionNames(document);
        }
        if (capturedSpecFreeze) {
            freezeSpecLayoutStateForHomeDocument();
        }
    };
}

// ===== After-swap event handler =====

function handleAfterSwap(
    state: TransitionState,
    deps: TransitionIntentSourceDependencies,
    runtimeWindow: RuntimeWindowWithTOC,
): void {
    state.didReplaceContentDuringVisit = true;
    setAwaitingReplaceState(false);
    activateEnterSkeleton();
    void deps.initFancybox();
    deps.checkKatex();
    deps.initKatexScrollbars();

    if (state.pendingSidebarProfilePatch) {
        applySidebarProfilePatch(state.pendingSidebarProfilePatch);
        state.pendingSidebarProfilePatch = null;
    }
    syncSidebarAvatarLoadingState(document);

    const tocElement = document.querySelector("table-of-contents") as
        | (HTMLElement & { init?: () => void })
        | null;
    const hasAnyTOCRuntime =
        typeof tocElement?.init === "function" ||
        typeof runtimeWindow.floatingTOCInit === "function";

    if (hasAnyTOCRuntime) {
        window.setTimeout(() => {
            tocElement?.init?.();
            runtimeWindow.floatingTOCInit?.();
        }, 100);
    }

    if (state.pendingBannerToSpecRoutePath) {
        startBannerToSpecMoveTransition(state);
    }
}

// ===== Page-view finalization helpers =====

function doVisitEndCleanup(state: TransitionState): void {
    state.navigationInProgress = false;
    const shouldForceCleanup = !state.didReplaceContentDuringVisit;
    if (shouldForceCleanup) {
        forceResetEnterSkeleton();
    }
    const remainingMs = getBannerToSpecRemainingMs(state);
    const hasPending = state.pendingBannerToSpecRoutePath !== null;
    if (shouldForceCleanup || (!hasPending && remainingMs <= 0)) {
        state.pendingBannerToSpecRoutePath = null;
        state.pendingSidebarProfilePatch = null;
        state.pendingSpecToBannerFreeze = false;
        clearBannerToSpecTransitionVisualState(state);
    }
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
        delete sidebar.dataset.sidebarPreserved;
    }
    const cleanupDelayMs = remainingMs > 0 ? Math.ceil(remainingMs) + 200 : 200;
    window.setTimeout(() => {
        setPageHeightExtendVisible(false);
        const toc = document.getElementById("toc-wrapper");
        if (toc) {
            toc.classList.remove("toc-not-ready");
        }
    }, cleanupDelayMs);
}

function finalizePageView(
    state: TransitionState,
    deps: TransitionIntentDeps,
): void {
    setAwaitingReplaceState(false);
    deactivateEnterSkeleton();
    const hash = window.location.hash?.slice(1);
    const didUseNavbarCommitFreeze = dispatchRouteChangeWithNavbarCommitFreeze(
        state,
        deps,
    );
    clearBannerToSpecTransitionVisualState(state, {
        preserveNavbarCommitFreeze: didUseNavbarCommitFreeze,
    });
    const isHomePage = deps.pathsEqual(window.location.pathname, deps.url("/"));
    const bannerTextOverlay = document.querySelector(".banner-text-overlay");
    if (bannerTextOverlay) {
        bannerTextOverlay.classList.toggle("hidden", !isHomePage);
    }
    setPageHeightExtendVisible(false);
    if (hash) {
        requestAnimationFrame(() => {
            scrollToHashBelowTocBaseline(hash, { behavior: "instant" });
        });
    } else {
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    const expectedThemeState = resolveExpectedThemeState(
        deps.defaultTheme,
        deps.darkMode,
    );
    const currentRoot = document.documentElement;
    const currentCodeTheme = currentRoot.getAttribute("data-theme");
    const hasDarkClass = currentRoot.classList.contains("dark");
    if (
        currentCodeTheme !== expectedThemeState.codeTheme ||
        hasDarkClass !== expectedThemeState.isDark
    ) {
        applyThemeStateToRoot(currentRoot, expectedThemeState);
    }
    window.setTimeout(() => {
        if (document.getElementById("tcomment")) {
            document.dispatchEvent(
                new CustomEvent("cialli:page:loaded", {
                    detail: {
                        path: window.location.pathname,
                        timestamp: Date.now(),
                    },
                }),
            );
        }
    }, 300);
    doVisitEndCleanup(state);
}

// ===== Page-load event handler =====

function handlePageLoad(
    state: TransitionState,
    deps: TransitionIntentDeps,
): void {
    if (!state.navigationInProgress) {
        return;
    }

    const remainingMs = getBannerToSpecRemainingMs(state);
    if (remainingMs > 0) {
        clearDelayedPageViewTimer(state);
        state.delayedPageViewTimerId = window.setTimeout(() => {
            state.delayedPageViewTimerId = null;
            finalizePageView(state, deps);
        }, Math.ceil(remainingMs));
        return;
    }

    finalizePageView(state, deps);
}

// ===== Main setup function =====

export function setupTransitionIntentSource(
    deps: TransitionIntentSourceDependencies,
): void {
    const runtimeWindow = window as RuntimeWindowWithTOC;

    const state: TransitionState = {
        pendingBannerToSpecRoutePath: null,
        pendingSidebarProfilePatch: null,
        bannerToSpecAnimationStartedAt: null,
        delayedPageViewTimerId: null,
        didReplaceContentDuringVisit: false,
        didForceNavbarScrolledForBannerToSpec: false,
        pendingSpecToBannerFreeze: false,
        navigationInProgress: false,
    };

    const transitionDeps: TransitionIntentDeps = {
        controller: deps.controller,
        defaultTheme: deps.defaultTheme,
        darkMode: deps.darkMode,
        pathsEqual: deps.pathsEqual,
        url: deps.url,
    };

    // Ensure spacer is always reset when tab visibility/lifecycle changes.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") {
            setPageHeightExtendVisible(false);
        }
    });
    window.addEventListener("pageshow", () => {
        setPageHeightExtendVisible(false);
    });

    document.addEventListener("astro:before-preparation", (event: Event) => {
        handleBeforePreparation(event as BeforePreparationEvent, state, deps);
    });

    document.addEventListener("astro:before-swap", (event: Event) => {
        handleBeforeSwap(event as BeforeSwapEvent, state, deps);
    });

    document.addEventListener("astro:after-swap", () => {
        handleAfterSwap(state, deps, runtimeWindow);
    });

    document.addEventListener("astro:page-load", () => {
        handlePageLoad(state, transitionDeps);
    });

    document.addEventListener("cialli:unsaved-navigation-cancel", () => {
        // 未保存拦截取消后，确保所有过渡视觉态立即回收，避免骨架屏残留。
        forceResetTransitionState(state);
    });
}
