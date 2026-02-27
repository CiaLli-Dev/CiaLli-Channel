import type { LayoutController } from "./layout-controller";
import {
    applySidebarProfilePatch,
    extractSidebarProfilePatch,
    syncSidebarAvatarLoadingState,
    type SidebarProfilePatch,
} from "./sidebar-profile-sync";
import {
    activateEnterSkeleton,
    deactivateEnterSkeleton,
    forceResetEnterSkeleton,
} from "./enter-skeleton";
import { scrollToHashBelowTocBaseline } from "@/utils/hash-scroll";
import { getTocBaselineOffset } from "@/utils/toc-offset";

const BANNER_TO_SPEC_TRANSITION_CLASS = "layout-banner-to-spec-transition";
const BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS =
    "layout-banner-to-spec-transition-preparing";
const BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS =
    "layout-banner-to-spec-transition-active";
const BANNER_TO_SPEC_NAVBAR_SYNC_CLASS = "layout-banner-to-spec-navbar-sync";
const BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS =
    "layout-banner-to-spec-navbar-commit-freeze";
const SPEC_TO_BANNER_TRANSITION_CLASS = "layout-spec-to-banner-transition";
const BANNER_TO_SPEC_SHIFT_VAR = "--layout-banner-route-up-shift";
const BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR =
    "--layout-banner-route-banner-extra-shift";
const BANNER_TO_SPEC_TRANSITION_DURATION_VAR =
    "--layout-banner-route-transition-duration";
const ENTER_SKELETON_AWAITING_REPLACE_CLASS = "enter-skeleton-awaiting-replace";
const BANNER_TO_SPEC_TRANSITION_DURATION_MS = 1200;
const COLLAPSED_MAIN_PANEL_TOP = "5.5rem";
const SIDEBAR_OVERSHOOT_TOLERANCE_PX = 0.75;

// Astro View Transitions event types
type BeforePreparationEvent = Event & {
    to: URL;
    from: URL;
};

type BeforeSwapEvent = Event & {
    newDocument: Document;
    swap: () => void;
};

function isCurrentHomeRoute(body: HTMLElement): boolean {
    if (body.dataset.routeHome === "true") {
        return true;
    }
    if (body.dataset.routeHome === "false") {
        return false;
    }
    return body.classList.contains("lg:is-home");
}

function normalizePathname(pathname: string): string {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized === "" ? "/" : normalized;
}

function parseCssLengthToPx(lengthValue: string): number | null {
    const trimmed = lengthValue.trim();
    if (!trimmed) {
        return null;
    }

    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.height = trimmed;
    document.body.appendChild(probe);
    const measuredPx = probe.getBoundingClientRect().height;
    probe.remove();

    if (!Number.isFinite(measuredPx) || measuredPx <= 0) {
        return null;
    }

    return measuredPx;
}

function resolveTargetMainPanelTopPx(newDocument?: Document): number {
    const targetMainPanel = newDocument?.querySelector<HTMLElement>(
        ".main-panel-wrapper",
    );
    const inlineTop = targetMainPanel?.style.top?.trim() || "";
    const parsedInlineTop =
        inlineTop.length > 0 ? parseCssLengthToPx(inlineTop) : null;
    if (parsedInlineTop !== null) {
        return parsedInlineTop;
    }

    const collapsedTopPx = parseCssLengthToPx(COLLAPSED_MAIN_PANEL_TOP);
    if (collapsedTopPx !== null) {
        return collapsedTopPx;
    }

    return getTocBaselineOffset();
}

function resolveAnchorViewportTop(selector: string): number | null {
    const element = document.querySelector<HTMLElement>(selector);
    if (!(element instanceof HTMLElement)) {
        return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) {
        return null;
    }

    return rect.top;
}

type BannerToSpecShiftMetrics = {
    mainPanelShiftPx: number;
    bannerExtraShiftPx: number;
};

function resolveBannerToSpecShiftMetrics(
    newDocument?: Document,
): BannerToSpecShiftMetrics {
    const targetTop = resolveTargetMainPanelTopPx(newDocument);
    const mainPanelTop = resolveAnchorViewportTop(".main-panel-wrapper");
    const resolvedBannerExtraShift = Math.max(0, Number(targetTop.toFixed(3)));
    if (mainPanelTop === null) {
        return {
            mainPanelShiftPx: 0,
            bannerExtraShiftPx: resolvedBannerExtraShift,
        };
    }

    const rawMainShift = mainPanelTop - targetTop;
    if (rawMainShift <= 0) {
        return {
            mainPanelShiftPx: 0,
            bannerExtraShiftPx: resolvedBannerExtraShift,
        };
    }

    const sidebarCap = ["#sidebar", "#right-sidebar-slot"]
        .map((selector) => resolveAnchorViewportTop(selector))
        .filter((top): top is number => typeof top === "number")
        .map((top) => top - (targetTop - SIDEBAR_OVERSHOOT_TOLERANCE_PX))
        .reduce<number>(
            (minCap, candidate) => Math.min(minCap, candidate),
            Number.POSITIVE_INFINITY,
        );

    const resolvedShift = Number.isFinite(sidebarCap)
        ? Math.min(rawMainShift, sidebarCap)
        : rawMainShift;

    return {
        mainPanelShiftPx: Math.max(0, Number(resolvedShift.toFixed(3))),
        bannerExtraShiftPx: resolvedBannerExtraShift,
    };
}

function applyBannerToSpecShiftVariables(
    newDocument?: Document,
    root: HTMLElement = document.documentElement,
): void {
    const { mainPanelShiftPx, bannerExtraShiftPx } =
        resolveBannerToSpecShiftMetrics(newDocument);
    root.style.setProperty(BANNER_TO_SPEC_SHIFT_VAR, `${mainPanelShiftPx}px`);
    root.style.setProperty(
        BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR,
        `${bannerExtraShiftPx}px`,
    );
}

function stripOnloadAnimationClasses(scope: HTMLElement): void {
    scope.classList.remove("onload-animation");
    const animatedElements =
        scope.querySelectorAll<HTMLElement>(".onload-animation");
    animatedElements.forEach((element) => {
        element.classList.remove("onload-animation");
        element.style.removeProperty("animation-delay");
    });
}

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

export function setupTransitionIntentSource(
    deps: TransitionIntentSourceDependencies,
): void {
    const runtimeWindow = window as Window &
        typeof globalThis & {
            floatingTOCInit?: () => void;
        };

    let pendingBannerToSpecRoutePath: string | null = null;
    let pendingSidebarProfilePatch: SidebarProfilePatch | null = null;
    let bannerToSpecAnimationStartedAt: number | null = null;
    let delayedPageViewTimerId: number | null = null;
    let didReplaceContentDuringVisit = false;
    let didForceNavbarScrolledForBannerToSpec = false;
    let pendingBannerToSpecNewDocument: Document | null = null;
    let pendingSpecToBannerRoutePath: string | null = null;
    let navigationInProgress = false;

    const setPageHeightExtendVisible = (visible: boolean): void => {
        const heightExtend = document.getElementById("page-height-extend");
        if (!heightExtend) {
            return;
        }
        heightExtend.classList.toggle("hidden", !visible);
    };

    const clearDelayedPageViewTimer = (): void => {
        if (delayedPageViewTimerId !== null) {
            window.clearTimeout(delayedPageViewTimerId);
            delayedPageViewTimerId = null;
        }
    };

    const forceNavbarScrolledForBannerToSpecTransition = (): void => {
        const navbar = document.getElementById("navbar");
        if (!(navbar instanceof HTMLElement)) {
            return;
        }
        if (!navbar.classList.contains("scrolled")) {
            navbar.classList.add("scrolled");
            didForceNavbarScrolledForBannerToSpec = true;
        }
    };

    const releaseForcedNavbarScrolledState = (): void => {
        if (!didForceNavbarScrolledForBannerToSpec) {
            return;
        }
        const navbar = document.getElementById("navbar");
        if (navbar instanceof HTMLElement) {
            navbar.classList.remove("scrolled");
        }
        didForceNavbarScrolledForBannerToSpec = false;
    };

    const setAwaitingReplaceState = (isAwaiting: boolean): void => {
        const root = document.documentElement;
        root.classList.toggle(
            ENTER_SKELETON_AWAITING_REPLACE_CLASS,
            isAwaiting,
        );
    };

    const getBannerToSpecRemainingMs = (): number => {
        if (
            !pendingBannerToSpecRoutePath ||
            bannerToSpecAnimationStartedAt === null
        ) {
            return 0;
        }
        const elapsedMs = performance.now() - bannerToSpecAnimationStartedAt;
        return Math.max(0, BANNER_TO_SPEC_TRANSITION_DURATION_MS - elapsedMs);
    };

    const clearBannerToSpecTransitionVisualState = (options?: {
        preserveNavbarCommitFreeze?: boolean;
    }): void => {
        clearDelayedPageViewTimer();
        bannerToSpecAnimationStartedAt = null;
        releaseForcedNavbarScrolledState();
        const root = document.documentElement;
        root.classList.remove(BANNER_TO_SPEC_TRANSITION_CLASS);
        root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
        root.classList.remove(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
        root.classList.remove(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
        if (!options?.preserveNavbarCommitFreeze) {
            root.classList.remove(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
        }
        root.classList.remove(SPEC_TO_BANNER_TRANSITION_CLASS);
        root.style.removeProperty(BANNER_TO_SPEC_SHIFT_VAR);
        root.style.removeProperty(BANNER_TO_SPEC_BANNER_EXTRA_SHIFT_VAR);
        root.style.removeProperty(BANNER_TO_SPEC_TRANSITION_DURATION_VAR);
        setPageHeightExtendVisible(false);
        // 清理命名 VT，防止影响后续导航
        const mainPanel = document.querySelector<HTMLElement>(
            ".main-panel-wrapper",
        );
        if (mainPanel) {
            mainPanel.style.removeProperty("view-transition-name");
        }
    };

    const startBannerToSpecMoveTransition = (): void => {
        if (
            !pendingBannerToSpecRoutePath ||
            bannerToSpecAnimationStartedAt !== null
        ) {
            return;
        }
        const root = document.documentElement;
        if (pendingBannerToSpecNewDocument) {
            applyBannerToSpecShiftVariables(
                pendingBannerToSpecNewDocument,
                root,
            );
        }
        forceNavbarScrolledForBannerToSpecTransition();
        root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
        root.classList.add(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
        root.classList.add(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
        bannerToSpecAnimationStartedAt = performance.now();
    };

    const dispatchRouteChangeWithNavbarCommitFreeze = (): boolean => {
        const commitRouteChange = (): void => {
            deps.controller.dispatch({
                type: "ROUTE_CHANGED",
                path: window.location.pathname,
                scrollTop: document.documentElement.scrollTop,
                viewportWidth: window.innerWidth,
                reason: "route-change",
            });
        };

        if (
            !pendingBannerToSpecRoutePath ||
            bannerToSpecAnimationStartedAt === null
        ) {
            commitRouteChange();
            return false;
        }

        const root = document.documentElement;
        root.classList.add(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
        commitRouteChange();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                root.classList.remove(
                    BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS,
                );
            });
        });
        return true;
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

    // ===== astro:before-preparation (replaces visit:start + link:click) =====
    document.addEventListener("astro:before-preparation", (event: Event) => {
        const e = event as BeforePreparationEvent;
        const targetPathname = normalizePathname(e.to.pathname);

        navigationInProgress = true;
        didReplaceContentDuringVisit = false;
        forceResetEnterSkeleton();
        setAwaitingReplaceState(true);
        deps.cleanupFancybox();
        pendingBannerToSpecRoutePath = null;
        pendingSidebarProfilePatch = null;
        pendingBannerToSpecNewDocument = null;
        pendingSpecToBannerRoutePath = null;
        bannerToSpecAnimationStartedAt = null;
        clearBannerToSpecTransitionVisualState();

        // was link:click
        document.documentElement.style.setProperty("--content-delay", "0ms");

        // Banner-to-spec detection
        const isTargetHome = deps.pathsEqual(targetPathname, deps.url("/"));
        const body = document.body;
        const currentPathname = normalizePathname(window.location.pathname);
        const currentIsHome =
            deps.pathsEqual(currentPathname, deps.url("/")) ||
            isCurrentHomeRoute(body);
        const hasBannerWrapper = document.getElementById("banner-wrapper");
        const shouldUseBannerToSpecTransition =
            currentIsHome && hasBannerWrapper !== null && !isTargetHome;

        if (shouldUseBannerToSpecTransition) {
            pendingBannerToSpecRoutePath = targetPathname;
            const root = document.documentElement;
            // Initial shift calculation without newDocument (uses fallback values)
            applyBannerToSpecShiftVariables(undefined, root);
            root.style.setProperty(
                BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
                `${BANNER_TO_SPEC_TRANSITION_DURATION_MS}ms`,
            );
            root.classList.add(BANNER_TO_SPEC_TRANSITION_CLASS);
            root.classList.add(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
            setPageHeightExtendVisible(true);
        } else {
            setPageHeightExtendVisible(false);
        }

        // Spec-to-banner detection
        const shouldUseSpecToBannerTransition = !currentIsHome && isTargetHome;
        if (shouldUseSpecToBannerTransition) {
            pendingSpecToBannerRoutePath = targetPathname;
            const root = document.documentElement;
            root.classList.add(SPEC_TO_BANNER_TRANSITION_CLASS);
        }

        // 任意方向的位移过渡均需设置旧页面命名 VT（VT 截图前必须已设置）
        if (
            shouldUseBannerToSpecTransition ||
            shouldUseSpecToBannerTransition
        ) {
            const oldMainPanel = document.querySelector<HTMLElement>(
                ".main-panel-wrapper",
            );
            if (oldMainPanel) {
                oldMainPanel.style.setProperty(
                    "view-transition-name",
                    "main-panel",
                );
            }
        }

        const toc = document.getElementById("toc-wrapper");
        if (toc) {
            toc.classList.add("toc-not-ready");
        }
    });

    // ===== astro:before-swap (replaces before:content:replace + content:scroll + animation:out:start) =====
    document.addEventListener("astro:before-swap", (event: Event) => {
        const e = event as BeforeSwapEvent;
        const newDocument = e.newDocument;
        pendingBannerToSpecNewDocument = newDocument;

        // ----- Sidebar preservation logic (was before:content:replace) -----
        pendingSidebarProfilePatch = null;
        const currentSidebar = document.querySelector<HTMLElement>("#sidebar");
        const newSidebar = newDocument.querySelector<HTMLElement>("#sidebar");
        let shouldPreserveSidebar = false;

        if (currentSidebar && newSidebar) {
            const currentUid = currentSidebar.getAttribute("data-sidebar-uid");
            const newUid = newSidebar.getAttribute("data-sidebar-uid");
            const currentLayoutKey =
                currentSidebar.getAttribute("data-sidebar-layout-key") || "";
            const newLayoutKey =
                newSidebar.getAttribute("data-sidebar-layout-key") || "";
            const layoutComparable =
                currentLayoutKey.length > 0 && newLayoutKey.length > 0;
            const sameLayout =
                layoutComparable && currentLayoutKey === newLayoutKey;
            const nextPatch = extractSidebarProfilePatch(newSidebar);
            const canPatch = sameLayout && nextPatch !== null;

            const prepareSidebarPreservation = (): void => {
                shouldPreserveSidebar = true;
                stripOnloadAnimationClasses(currentSidebar);
                currentSidebar.dataset.sidebarPreserved = "";
                const nextScrollable =
                    newSidebar.getAttribute("data-scrollable");
                if (nextScrollable) {
                    currentSidebar.setAttribute(
                        "data-scrollable",
                        nextScrollable,
                    );
                }
            };

            if (currentUid && newUid && currentUid === newUid) {
                if (layoutComparable && !sameLayout) {
                    // Same account but different widget layout -> full sidebar replace
                } else {
                    prepareSidebarPreservation();
                    if (canPatch) {
                        pendingSidebarProfilePatch =
                            nextPatch as SidebarProfilePatch;
                    }
                }
            } else if (currentUid && newUid && sameLayout) {
                if (canPatch) {
                    prepareSidebarPreservation();
                    pendingSidebarProfilePatch =
                        nextPatch as SidebarProfilePatch;
                }
            }
        }

        // ----- #main-grid class sync -----
        const newMainGrid = newDocument.querySelector("#main-grid");
        const currentMainGrid = document.getElementById("main-grid");
        if (newMainGrid instanceof HTMLElement && currentMainGrid) {
            currentMainGrid.className = newMainGrid.className;
        }

        // ----- Banner-to-spec: recalculate shift with actual newDocument -----
        if (pendingBannerToSpecRoutePath) {
            applyBannerToSpecShiftVariables(newDocument);
        }

        // ----- Custom swap: sidebar preservation + scroll suppression -----
        const savedSidebar = shouldPreserveSidebar
            ? document.querySelector<HTMLElement>("#sidebar")
            : null;
        const savedScrollY = window.scrollY;
        const suppressScroll = Boolean(pendingBannerToSpecRoutePath);

        const originalSwap = e.swap;
        e.swap = () => {
            originalSwap();

            // Restore preserved sidebar after default swap replaced everything
            if (savedSidebar) {
                const newSidebarInDom = document.querySelector("#sidebar");
                if (newSidebarInDom) {
                    newSidebarInDom.replaceWith(savedSidebar);
                }
            }

            // Suppress scroll reset during banner-to-spec transitions
            if (suppressScroll) {
                window.scrollTo(0, savedScrollY);
            }

            // swap 后立即给新页面 .main-panel-wrapper 设置命名 VT
            if (pendingBannerToSpecRoutePath || pendingSpecToBannerRoutePath) {
                const newMainPanel = document.querySelector<HTMLElement>(
                    ".main-panel-wrapper",
                );
                if (newMainPanel) {
                    newMainPanel.style.setProperty(
                        "view-transition-name",
                        "main-panel",
                    );
                }
            }
        };
    });

    // ===== astro:after-swap (replaces content:replace) =====
    document.addEventListener("astro:after-swap", () => {
        didReplaceContentDuringVisit = true;
        setAwaitingReplaceState(false);
        activateEnterSkeleton();
        void deps.initFancybox();
        deps.checkKatex();
        deps.initKatexScrollbars();

        if (pendingSidebarProfilePatch) {
            applySidebarProfilePatch(pendingSidebarProfilePatch);
            pendingSidebarProfilePatch = null;
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

        // Start banner-to-spec animation now that content is replaced
        if (pendingBannerToSpecRoutePath) {
            startBannerToSpecMoveTransition();
        }
    });

    // ===== astro:page-load (replaces page:view + visit:end) =====
    document.addEventListener("astro:page-load", () => {
        // Skip on initial page load (no navigation in progress)
        if (!navigationInProgress) {
            return;
        }

        const finalizePageView = (): void => {
            setAwaitingReplaceState(false);
            deactivateEnterSkeleton();
            const hash = window.location.hash?.slice(1);

            const didUseNavbarCommitFreeze =
                dispatchRouteChangeWithNavbarCommitFreeze();

            clearBannerToSpecTransitionVisualState({
                preserveNavbarCommitFreeze: didUseNavbarCommitFreeze,
            });

            const isHomePage = deps.pathsEqual(
                window.location.pathname,
                deps.url("/"),
            );

            const bannerTextOverlay = document.querySelector(
                ".banner-text-overlay",
            );
            if (bannerTextOverlay) {
                if (isHomePage) {
                    bannerTextOverlay.classList.remove("hidden");
                } else {
                    bannerTextOverlay.classList.add("hidden");
                }
            }

            setPageHeightExtendVisible(false);

            if (hash) {
                requestAnimationFrame(() => {
                    scrollToHashBelowTocBaseline(hash, {
                        behavior: "instant",
                    });
                });
            } else {
                window.scrollTo({
                    top: 0,
                    behavior: "instant" as ScrollBehavior,
                });
            }

            // Theme sync
            const storedTheme =
                localStorage.getItem("theme") || deps.defaultTheme;
            const isDark = storedTheme === deps.darkMode;
            const expectedTheme = isDark ? "github-dark" : "github-light";
            const currentTheme =
                document.documentElement.getAttribute("data-theme");
            const hasDarkClass =
                document.documentElement.classList.contains("dark");

            if (currentTheme !== expectedTheme || hasDarkClass !== isDark) {
                requestAnimationFrame(() => {
                    if (currentTheme !== expectedTheme) {
                        document.documentElement.setAttribute(
                            "data-theme",
                            expectedTheme,
                        );
                    }
                    if (hasDarkClass !== isDark) {
                        if (isDark) {
                            document.documentElement.classList.add("dark");
                        } else {
                            document.documentElement.classList.remove("dark");
                        }
                    }
                });
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

            // visit:end cleanup
            doVisitEndCleanup();
        };

        const remainingMs = getBannerToSpecRemainingMs();
        if (remainingMs > 0) {
            clearDelayedPageViewTimer();
            delayedPageViewTimerId = window.setTimeout(() => {
                delayedPageViewTimerId = null;
                finalizePageView();
            }, Math.ceil(remainingMs));
            return;
        }

        finalizePageView();
    });

    const doVisitEndCleanup = (): void => {
        navigationInProgress = false;

        const shouldForceCleanupForAbortedVisit = !didReplaceContentDuringVisit;
        if (shouldForceCleanupForAbortedVisit) {
            forceResetEnterSkeleton();
        }

        const remainingMs = getBannerToSpecRemainingMs();
        const hasPendingBannerToSpecTransition =
            pendingBannerToSpecRoutePath !== null;
        if (
            shouldForceCleanupForAbortedVisit ||
            (!hasPendingBannerToSpecTransition && remainingMs <= 0)
        ) {
            pendingBannerToSpecRoutePath = null;
            pendingSidebarProfilePatch = null;
            pendingBannerToSpecNewDocument = null;
            pendingSpecToBannerRoutePath = null;
            clearBannerToSpecTransitionVisualState();
        }

        const sidebar = document.getElementById("sidebar");
        if (sidebar) {
            delete sidebar.dataset.sidebarPreserved;
        }

        const cleanupDelayMs =
            remainingMs > 0 ? Math.ceil(remainingMs) + 200 : 200;
        window.setTimeout(() => {
            setPageHeightExtendVisible(false);
            const toc = document.getElementById("toc-wrapper");
            if (toc) {
                toc.classList.remove("toc-not-ready");
            }
        }, cleanupDelayMs);
    };
}
