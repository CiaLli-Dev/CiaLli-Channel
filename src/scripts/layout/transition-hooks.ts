/* eslint-disable max-lines -- 该文件集中承载导航过渡状态机与 Astro 生命周期衔接逻辑。 */
import type { LayoutController } from "./layout-controller";
import {
    applySidebarProfilePatch,
    syncSidebarAvatarLoadingState,
} from "./sidebar-profile-sync";
import {
    deactivateEnterSkeleton,
    forceResetEnterSkeleton,
    resolveTransitionProxyPayloadFromPath,
    syncEnterSkeletonStateToIncomingDocument,
} from "./enter-skeleton";
import type { TransitionProxyPayload } from "./enter-skeleton";
import { scrollToHashBelowTocBaseline } from "@/utils/hash-scroll";
import {
    isCurrentHomeRoute,
    normalizePathname,
    isSameNavigationTarget,
    shouldStartBannerToSpecTransition,
    stripOnloadAnimationClasses,
    freezeSpecLayoutStateForHomeDocument,
    applyBannerToSpecShiftVariables,
    applyTransitionProxySkeleton,
    clearBannerToSpecMotionTimer,
    clearTransitionProxyEnterFrame,
    clearTransitionProxyEnterTimer,
    syncRootRuntimeStateToIncomingDocument,
    setPageHeightExtendVisible,
    setAwaitingReplaceState,
    resolveSidebarPreservation,
    clearDelayedPageViewTimer,
    getBannerToSpecRemainingMs,
    clearBannerToSpecTransitionVisualState,
    markBannerToSpecMotionCompleted,
    resolveTransitionProxyPayloadFromDocument,
    setIncomingBannerToSpecSettledState,
    mountTransitionProxy,
    startTransitionProxyEnter,
    startBannerToSpecMoveTransition,
    startTransitionProxyReveal,
    settleTransitionProxyEnter,
    dispatchRouteChangeWithNavbarCommitFreeze,
    resolveExpectedThemeState,
    applyThemeStateToRoot,
    BANNER_TO_SPEC_TRANSITION_CLASS,
    BANNER_TO_SPEC_LIVE_CLASS,
    BANNER_TO_SPEC_NAVBAR_SYNC_CLASS,
    BANNER_TO_SPEC_PROXY_ENTER_DURATION_MS,
    BANNER_TO_SPEC_PROXY_REVEAL_DURATION_MS,
    BANNER_TO_SPEC_PROXY_VISIBLE_CLASS,
    BANNER_TO_SPEC_SETTLED_CLASS,
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
    loader: () => Promise<void>;
    navigationType?: string;
};

type BeforeSwapEvent = Event & {
    newDocument: Document;
    viewTransition?: {
        finished: Promise<unknown>;
    };
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

type NavigationPhase = "idle" | "preparing" | "swapped" | "settling";

const NAVIGATION_PHASE_ATTR = "data-nav-phase";
const NAVIGATION_SETTLED_EVENT = "cialli:navigation:settled";
const ONLOAD_STRIP_SCOPE_IDS = [
    "top-row",
    "content-wrapper",
    "sidebar",
    "right-sidebar-slot",
    "toc-wrapper",
] as const;

type PreparationTransitionProxyDecision = {
    payload: TransitionProxyPayload | null;
    preservePreparedPayload: boolean;
};

type PreparationRouteState = {
    sourcePathname: string;
    targetPathname: string;
    currentIsHome: boolean;
    isTargetHome: boolean;
};

function setNavigationPhase(
    phase: NavigationPhase,
    targetDocument: Document = document,
): void {
    targetDocument.documentElement.setAttribute(NAVIGATION_PHASE_ATTR, phase);
}

function stripOnloadAnimationsInDocument(targetDocument: Document): void {
    // 客户端切页时只剥离高风险容器的 onload 关键帧，
    // 避免骨架结束后再次触发“二次揭幕”造成抽动
    for (const id of ONLOAD_STRIP_SCOPE_IDS) {
        const scope = targetDocument.getElementById(id);
        if (scope instanceof HTMLElement) {
            stripOnloadAnimationClasses(scope);
        }
    }
}

function dispatchNavigationSettledEvent(navigationToken: number): void {
    document.dispatchEvent(
        new CustomEvent(NAVIGATION_SETTLED_EVENT, {
            detail: {
                token: navigationToken,
                path: window.location.pathname,
                timestamp: Date.now(),
            },
        }),
    );
}

// ===== Before-preparation helpers =====

function resetNavigationState(state: TransitionState): void {
    state.pendingBannerToSpecRoutePath = null;
    state.pendingTransitionProxyRoutePath = null;
    state.pendingSidebarProfilePatch = null;
    state.pendingBannerWaveAnimationSnapshot = null;
    state.pendingSpecToBannerFreeze = false;
    state.bannerToSpecAnimationStartedAt = null;
    state.transitionProxyMode = null;
    state.transitionProxyLayoutKey = null;
    state.preservePreparedTransitionProxyPayload = false;
    state.bannerToSpecMotionCompleted = false;
    state.bannerToSpecLoaderSettled = false;
    state.viewTransitionFinished = null;
}

function forceResetTransitionState(state: TransitionState): void {
    state.navigationInProgress = false;
    state.didReplaceContentDuringVisit = false;
    clearBannerToSpecMotionTimer(state);
    if (state.proxyRevealTimerId !== null) {
        window.clearTimeout(state.proxyRevealTimerId);
        state.proxyRevealTimerId = null;
    }
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
    const proxyPayload = resolveTransitionProxyPayloadFromPath(targetPathname);
    state.pendingBannerToSpecRoutePath = targetPathname;
    state.pendingTransitionProxyRoutePath = targetPathname;
    state.transitionProxyMode = proxyPayload.mode;
    state.transitionProxyLayoutKey = proxyPayload.layoutKey;
    const root = document.documentElement;
    root.style.setProperty(
        BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
        `${BANNER_TO_SPEC_TRANSITION_DURATION_MS}ms`,
    );
    root.classList.add(BANNER_TO_SPEC_TRANSITION_CLASS);
    setPageHeightExtendVisible(true);
}

function hasPendingTransitionProxy(state: TransitionState): boolean {
    return (
        state.pendingTransitionProxyRoutePath !== null &&
        state.transitionProxyMode !== null &&
        state.transitionProxyLayoutKey !== null
    );
}

function getPendingTransitionProxyPayload(state: TransitionState): {
    mode: NonNullable<TransitionState["transitionProxyMode"]>;
    layoutKey: NonNullable<TransitionState["transitionProxyLayoutKey"]>;
} | null {
    const mode = state.transitionProxyMode;
    const layoutKey = state.transitionProxyLayoutKey;
    if (
        state.pendingTransitionProxyRoutePath === null ||
        mode === null ||
        layoutKey === null
    ) {
        return null;
    }
    return {
        mode,
        layoutKey,
    };
}

function clearTransitionProxyEnterScheduling(state: TransitionState): void {
    clearTransitionProxyEnterFrame(state);
    clearTransitionProxyEnterTimer(state);
    settleTransitionProxyEnter();
}

function scheduleTransitionProxyEnter(state: TransitionState): void {
    clearTransitionProxyEnterScheduling(state);
    startTransitionProxyEnter();
    state.proxyEnterFrameId = window.requestAnimationFrame(() => {
        state.proxyEnterFrameId = null;
        const prefersReducedMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        ).matches;
        if (prefersReducedMotion) {
            settleTransitionProxyEnter();
            return;
        }
        state.proxyEnterTimerId = window.setTimeout(() => {
            state.proxyEnterTimerId = null;
            settleTransitionProxyEnter();
        }, BANNER_TO_SPEC_PROXY_ENTER_DURATION_MS);
    });
}

function resetViewportForIncomingPage(): void {
    if (window.scrollY <= 0) {
        return;
    }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}

export function shouldResetViewportOnPreparation(
    shouldUseBannerToSpec: boolean,
): boolean {
    // 首页 banner -> spec 需要保留当前视口位置，让“整页上推”从用户当下看到的区域立即开始，
    // 否则准备阶段先回顶会露出 banner 原始首屏，破坏空间连续性。
    return !shouldUseBannerToSpec;
}

export function resolvePreparationTransitionProxyPayload(
    currentPathname: string,
    targetPathname: string,
    currentDocument: Document,
    isTargetHome: boolean,
    shouldUseBannerToSpec: boolean,
): PreparationTransitionProxyDecision {
    if (shouldUseBannerToSpec) {
        return {
            payload: null,
            preservePreparedPayload: false,
        };
    }

    if (isTargetHome) {
        // 返回首页时，点击瞬间与 swap 后都应沿用来源页的骨架壳，
        // 不能回退成首页 fallback，否则会在过渡中途“换壳”。
        return {
            payload: resolveTransitionProxyPayloadFromDocument(
                currentDocument,
                currentPathname,
            ),
            preservePreparedPayload: true,
        };
    }

    // 除首页 banner -> spec 的整页上推动画外，其余跨页导航都应在点击瞬间
    // 先切入 proxy 骨架，包括 spec -> home，保证体感与 spec -> spec 一致。
    return {
        payload: resolveTransitionProxyPayloadFromPath(targetPathname),
        preservePreparedPayload: false,
    };
}

export function resolvePreparationRouteState(
    sourcePathname: string,
    targetPathname: string,
    body: HTMLElement,
    deps: Pick<TransitionIntentSourceDependencies, "pathsEqual" | "url">,
): PreparationRouteState {
    const normalizedSourcePathname = normalizePathname(sourcePathname);
    const normalizedTargetPathname = normalizePathname(targetPathname);
    const isTargetHome = deps.pathsEqual(
        normalizedTargetPathname,
        deps.url("/"),
    );
    const currentIsHome =
        deps.pathsEqual(normalizedSourcePathname, deps.url("/")) ||
        isCurrentHomeRoute(body);

    return {
        sourcePathname: normalizedSourcePathname,
        targetPathname: normalizedTargetPathname,
        currentIsHome,
        isTargetHome,
    };
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
        setNavigationPhase("idle");
        state.navigationInProgress = false;
        state.didReplaceContentDuringVisit = false;
        state.lastFinalizedNavigationToken = null;
        resetNavigationState(state);
        clearBannerToSpecTransitionVisualState(state);
        setAwaitingReplaceState(false);
        setPageHeightExtendVisible(false);
        forceResetEnterSkeleton();
        return;
    }

    state.navigationToken += 1;
    state.navigationInProgress = true;
    state.didReplaceContentDuringVisit = false;
    state.lastFinalizedNavigationToken = null;
    forceResetEnterSkeleton();
    setAwaitingReplaceState(true);
    setNavigationPhase("preparing");
    deps.cleanupFancybox();
    resetNavigationState(state);
    clearBannerToSpecTransitionVisualState(state);
    document.documentElement.style.setProperty("--content-delay", "0ms");

    const body = document.body;
    const routeState = resolvePreparationRouteState(
        e.from.pathname,
        e.to.pathname,
        body,
        deps,
    );
    const { sourcePathname, targetPathname, currentIsHome, isTargetHome } =
        routeState;
    const currentBannerWrapper = document.getElementById(
        "banner-wrapper",
    ) as HTMLElement | null;
    const shouldUseBannerToSpec = shouldStartBannerToSpecTransition({
        currentIsHome,
        isTargetHome,
        body,
        bannerWrapper: currentBannerWrapper,
    });
    const preparationProxyDecision = resolvePreparationTransitionProxyPayload(
        sourcePathname,
        targetPathname,
        document,
        isTargetHome,
        shouldUseBannerToSpec,
    );
    const immediateProxyPayload = preparationProxyDecision.payload;
    state.preservePreparedTransitionProxyPayload =
        preparationProxyDecision.preservePreparedPayload;

    if (shouldUseBannerToSpec) {
        applyBannerToSpecTransitionSetup(state, targetPathname);
        applyBannerToSpecShiftVariables();
        const pendingProxyPayload = getPendingTransitionProxyPayload(state);
        if (
            pendingProxyPayload &&
            applyTransitionProxySkeleton(pendingProxyPayload, document)
        ) {
            scheduleTransitionProxyEnter(state);
        }
        // 立即在当前首页文档启动“全屏上滑”，
        // 让代理骨架在加载阶段就可见，而不是等 incoming 文档 ready 后才开动。
        startBannerToSpecMoveTransition(state);

        const originalLoader = e.loader;
        e.loader = async () => {
            try {
                const motionPromise =
                    state.bannerToSpecMotionPromise ?? Promise.resolve();
                // swap 进入前同时等待内容加载与宏观位移动画完成，
                // 这样不会出现“旧页还没动，新页已经 ready”的空转窗口。
                await Promise.all([originalLoader(), motionPromise]);
                state.bannerToSpecLoaderSettled = true;
                markBannerToSpecMotionCompleted(state);
            } catch (error) {
                forceResetTransitionState(state);
                throw error;
            }
        };
    } else if (immediateProxyPayload) {
        state.pendingTransitionProxyRoutePath = targetPathname;
        state.transitionProxyMode = immediateProxyPayload.mode;
        state.transitionProxyLayoutKey = immediateProxyPayload.layoutKey;
        if (applyTransitionProxySkeleton(immediateProxyPayload, document)) {
            scheduleTransitionProxyEnter(state);
        } else {
            state.pendingTransitionProxyRoutePath = null;
            state.transitionProxyMode = null;
            state.transitionProxyLayoutKey = null;
        }
        setPageHeightExtendVisible(false);
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

    // 整页骨架只打到 incoming 文档，避免 outgoing 页面先闪成骨架。
    // 仅非 banner -> spec 路径需要在准备阶段回顶，banner -> spec 则必须保留当前视口，
    // 让宏观上推动画从当前所见区域直接开始。
    if (shouldResetViewportOnPreparation(shouldUseBannerToSpec)) {
        resetViewportForIncomingPage();
    }
}

// ===== Before-swap event handler =====

function handleBeforeSwap(
    e: BeforeSwapEvent,
    state: TransitionState,
    deps: TransitionIntentSourceDependencies,
): void {
    const newDocument = e.newDocument;
    state.viewTransitionFinished = e.viewTransition
        ? Promise.resolve(e.viewTransition.finished).then(
              () => undefined,
              () => undefined,
          )
        : null;

    stripOnloadAnimationsInDocument(document);

    syncRootRuntimeStateToIncomingDocument(
        newDocument,
        deps.defaultTheme,
        deps.darkMode,
    );
    if (hasPendingTransitionProxy(state)) {
        const preparedProxyPayload = getPendingTransitionProxyPayload(state);
        const resolvedProxyPayload =
            state.preservePreparedTransitionProxyPayload &&
            preparedProxyPayload !== null
                ? preparedProxyPayload
                : resolveTransitionProxyPayloadFromDocument(
                      newDocument,
                      state.pendingTransitionProxyRoutePath ?? undefined,
                  );
        state.transitionProxyMode = resolvedProxyPayload.mode;
        state.transitionProxyLayoutKey = resolvedProxyPayload.layoutKey;
        const didPrepareProxy = applyTransitionProxySkeleton(
            resolvedProxyPayload,
            newDocument,
        );
        if (didPrepareProxy) {
            mountTransitionProxy(newDocument);
            if (state.pendingBannerToSpecRoutePath) {
                setIncomingBannerToSpecSettledState(newDocument);
            }
        } else {
            const incomingRoot = newDocument.documentElement;
            incomingRoot.classList.remove(BANNER_TO_SPEC_TRANSITION_CLASS);
            incomingRoot.classList.remove(BANNER_TO_SPEC_LIVE_CLASS);
            incomingRoot.classList.remove(BANNER_TO_SPEC_SETTLED_CLASS);
            incomingRoot.classList.remove(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS);
            incomingRoot.classList.remove(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
            state.pendingBannerToSpecRoutePath = null;
            state.pendingTransitionProxyRoutePath = null;
            state.transitionProxyMode = null;
            state.transitionProxyLayoutKey = null;
            state.preservePreparedTransitionProxyPayload = false;
            syncEnterSkeletonStateToIncomingDocument(newDocument);
        }
    } else {
        syncEnterSkeletonStateToIncomingDocument(newDocument);
    }
    stripOnloadAnimationsInDocument(newDocument);
    setNavigationPhase("swapped", newDocument);

    // spec -> home：在交换前就冻结 incoming body 布局态，避免交换瞬间出现一帧 navbar 尺寸闪动
    if (state.pendingSpecToBannerFreeze) {
        freezeSpecLayoutStateForHomeDocument(newDocument);
    }

    state.pendingSidebarProfilePatch = null;
    const currentSidebar = document.querySelector<HTMLElement>("#sidebar");
    const newSidebar = newDocument.querySelector<HTMLElement>("#sidebar");
    let shouldPreserveSidebar = false;

    if (currentSidebar && newSidebar) {
        const result = resolveSidebarPreservation(currentSidebar, newSidebar);
        shouldPreserveSidebar = result.shouldPreserveSidebar;
        state.pendingSidebarProfilePatch = result.patch;
    }

    const savedSidebar = shouldPreserveSidebar
        ? document.querySelector<HTMLElement>("#sidebar")
        : null;
    const capturedSpecFreeze = state.pendingSpecToBannerFreeze;

    const originalSwap = e.swap;
    e.swap = () => {
        originalSwap();
        setNavigationPhase("swapped");
        if (savedSidebar) {
            const inDom = document.querySelector("#sidebar");
            if (inDom) {
                inDom.replaceWith(savedSidebar);
            }
        }
        if (capturedSpecFreeze) {
            freezeSpecLayoutStateForHomeDocument();
        }
    };
}

async function finalizePageViewWhenReady(
    state: TransitionState,
    transitionDeps: TransitionIntentDeps,
    sourceDeps: TransitionIntentSourceDependencies,
    runtimeWindow: RuntimeWindowWithTOC,
    navigationToken: number,
): Promise<void> {
    if (state.viewTransitionFinished) {
        await state.viewTransitionFinished;
    }

    if (
        navigationToken !== state.navigationToken ||
        !state.navigationInProgress
    ) {
        return;
    }

    const remainingMs = getBannerToSpecRemainingMs(state);
    if (remainingMs > 0) {
        clearDelayedPageViewTimer(state);
        state.delayedPageViewTimerId = window.setTimeout(() => {
            state.delayedPageViewTimerId = null;
            if (
                navigationToken !== state.navigationToken ||
                !state.navigationInProgress
            ) {
                return;
            }
            finalizePageView(
                state,
                transitionDeps,
                sourceDeps,
                runtimeWindow,
                navigationToken,
            );
        }, Math.ceil(remainingMs));
        return;
    }

    finalizePageView(
        state,
        transitionDeps,
        sourceDeps,
        runtimeWindow,
        navigationToken,
    );
}

// ===== After-swap event handler =====

function handleAfterSwap(state: TransitionState): void {
    state.didReplaceContentDuringVisit = true;
    setAwaitingReplaceState(false);
    setNavigationPhase("swapped");

    if (state.pendingSidebarProfilePatch) {
        applySidebarProfilePatch(state.pendingSidebarProfilePatch);
        state.pendingSidebarProfilePatch = null;
    }
    syncSidebarAvatarLoadingState(document);

    if (hasPendingTransitionProxy(state)) {
        const root = document.documentElement;
        if (state.pendingBannerToSpecRoutePath) {
            root.classList.remove(BANNER_TO_SPEC_LIVE_CLASS);
            root.classList.add(BANNER_TO_SPEC_SETTLED_CLASS);
        }
        root.classList.add(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS);
        state.pendingBannerWaveAnimationSnapshot = null;
    }
}

// ===== Page-view finalization helpers =====

function doVisitEndCleanup(
    state: TransitionState,
    navigationToken: number,
): void {
    state.navigationInProgress = false;
    const shouldForceCleanup = !state.didReplaceContentDuringVisit;
    if (shouldForceCleanup) {
        forceResetEnterSkeleton();
    }
    const remainingMs = getBannerToSpecRemainingMs(state);
    const hasPending = hasPendingTransitionProxy(state);
    if (shouldForceCleanup || (!hasPending && remainingMs <= 0)) {
        state.pendingBannerToSpecRoutePath = null;
        state.pendingTransitionProxyRoutePath = null;
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
        if (navigationToken !== state.navigationToken) {
            return;
        }
        setPageHeightExtendVisible(false);
        const toc = document.getElementById("toc-wrapper");
        if (toc) {
            toc.classList.remove("toc-not-ready");
        }
    }, cleanupDelayMs);
}

function finalizePageView(
    state: TransitionState,
    transitionDeps: TransitionIntentDeps,
    sourceDeps: TransitionIntentSourceDependencies,
    runtimeWindow: RuntimeWindowWithTOC,
    navigationToken: number,
): void {
    if (navigationToken !== state.navigationToken) {
        return;
    }
    if (state.lastFinalizedNavigationToken === navigationToken) {
        return;
    }
    state.lastFinalizedNavigationToken = navigationToken;
    setNavigationPhase("settling");
    setAwaitingReplaceState(false);
    deactivateEnterSkeleton();
    const hash = window.location.hash?.slice(1);
    const didUseNavbarCommitFreeze = dispatchRouteChangeWithNavbarCommitFreeze(
        state,
        transitionDeps,
    );
    const isHomePage = transitionDeps.pathsEqual(
        window.location.pathname,
        transitionDeps.url("/"),
    );
    if (hash) {
        requestAnimationFrame(() => {
            scrollToHashBelowTocBaseline(hash, { behavior: "instant" });
        });
    } else {
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    const expectedThemeState = resolveExpectedThemeState(
        transitionDeps.defaultTheme,
        transitionDeps.darkMode,
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

    const finishAfterReveal = (): void => {
        if (navigationToken !== state.navigationToken) {
            return;
        }
        clearBannerToSpecTransitionVisualState(state, {
            preserveNavbarCommitFreeze: didUseNavbarCommitFreeze,
        });
        state.pendingBannerToSpecRoutePath = null;
        state.pendingTransitionProxyRoutePath = null;
        state.pendingSidebarProfilePatch = null;
        state.pendingSpecToBannerFreeze = false;
        state.preservePreparedTransitionProxyPayload = false;
        const bannerTextOverlay = document.querySelector(
            ".banner-text-overlay",
        );
        if (bannerTextOverlay) {
            bannerTextOverlay.classList.toggle("hidden", !isHomePage);
        }
        setPageHeightExtendVisible(false);

        // 过渡完成后再恢复重初始化任务，避免动画窗口内主线程抖动
        requestAnimationFrame(() => {
            if (navigationToken !== state.navigationToken) {
                return;
            }
            void sourceDeps.initFancybox();
            sourceDeps.checkKatex();
            sourceDeps.initKatexScrollbars();

            const tocElement = document.querySelector("table-of-contents") as
                | (HTMLElement & { init?: () => void })
                | null;
            const hasAnyTOCRuntime =
                typeof tocElement?.init === "function" ||
                typeof runtimeWindow.floatingTOCInit === "function";

            if (hasAnyTOCRuntime) {
                window.setTimeout(() => {
                    if (navigationToken !== state.navigationToken) {
                        return;
                    }
                    tocElement?.init?.();
                    runtimeWindow.floatingTOCInit?.();
                }, 100);
            }
        });

        window.setTimeout(() => {
            if (navigationToken !== state.navigationToken) {
                return;
            }
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
        setNavigationPhase("idle");
        dispatchNavigationSettledEvent(navigationToken);
        doVisitEndCleanup(state, navigationToken);
    };

    if (hasPendingTransitionProxy(state)) {
        clearTransitionProxyEnterScheduling(state);
        startTransitionProxyReveal();
        if (state.proxyRevealTimerId !== null) {
            window.clearTimeout(state.proxyRevealTimerId);
        }
        state.proxyRevealTimerId = window.setTimeout(() => {
            state.proxyRevealTimerId = null;
            finishAfterReveal();
        }, BANNER_TO_SPEC_PROXY_REVEAL_DURATION_MS);
        return;
    }

    finishAfterReveal();
}

// ===== Page-load event handler =====

function handlePageLoad(
    state: TransitionState,
    transitionDeps: TransitionIntentDeps,
    sourceDeps: TransitionIntentSourceDependencies,
    runtimeWindow: RuntimeWindowWithTOC,
): void {
    if (!state.navigationInProgress) {
        return;
    }
    const navigationToken = state.navigationToken;
    void finalizePageViewWhenReady(
        state,
        transitionDeps,
        sourceDeps,
        runtimeWindow,
        navigationToken,
    );
}

// ===== Main setup function =====

export function setupTransitionIntentSource(
    deps: TransitionIntentSourceDependencies,
): void {
    const runtimeWindow = window as RuntimeWindowWithTOC;
    setNavigationPhase("idle");

    const state: TransitionState = {
        pendingBannerToSpecRoutePath: null,
        pendingTransitionProxyRoutePath: null,
        pendingSidebarProfilePatch: null,
        pendingBannerWaveAnimationSnapshot: null,
        bannerToSpecAnimationStartedAt: null,
        bannerToSpecMotionDurationMs: BANNER_TO_SPEC_TRANSITION_DURATION_MS,
        transitionProxyMode: null,
        transitionProxyLayoutKey: null,
        preservePreparedTransitionProxyPayload: false,
        bannerToSpecMotionCompleted: false,
        bannerToSpecMotionPromise: null,
        bannerToSpecMotionResolve: null,
        bannerToSpecMotionTimerId: null,
        bannerToSpecLoaderSettled: false,
        proxyEnterFrameId: null,
        proxyEnterTimerId: null,
        proxyRevealTimerId: null,
        viewTransitionFinished: null,
        delayedPageViewTimerId: null,
        didReplaceContentDuringVisit: false,
        didForceNavbarScrolledForBannerToSpec: false,
        pendingSpecToBannerFreeze: false,
        navigationInProgress: false,
        navigationToken: 0,
        lastFinalizedNavigationToken: null,
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
        handleAfterSwap(state);
    });

    document.addEventListener("astro:page-load", () => {
        handlePageLoad(state, transitionDeps, deps, runtimeWindow);
    });

    document.addEventListener("cialli:unsaved-navigation-cancel", () => {
        // 未保存拦截取消后，确保所有过渡视觉态立即回收，避免骨架屏残留。
        forceResetTransitionState(state);
    });
}
