/* eslint-disable max-lines -- 该工具文件承载完整过渡状态机常量与实现，按当前边界保留单文件 */
import { getTocBaselineOffset } from "@/utils/toc-offset";
import {
    extractSidebarProfilePatch,
    type SidebarProfilePatch,
} from "./sidebar-profile-sync";
import {
    resolveEnterSkeletonModeFromPath,
    resolveTransitionProxyLayoutKeyFromPath,
    type EnterSkeletonMode,
    type TransitionProxyLayoutKey,
    type TransitionProxyPayload,
} from "./enter-skeleton";
import type { LayoutController } from "./layout-controller";

const COLLAPSED_MAIN_PANEL_TOP_VALUE = "5.5rem";
const SIDEBAR_OVERSHOOT_TOLERANCE_PX_VALUE = 0.75;

// ===== Exported CSS class / var name constants =====
export const BANNER_TO_SPEC_TRANSITION_CLASS =
    "layout-banner-to-spec-transition";
export const BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS =
    "layout-banner-to-spec-transition-preparing";
export const BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS =
    "layout-banner-to-spec-transition-active";
export const BANNER_TO_SPEC_LIVE_CLASS = "layout-banner-to-spec-live-active";
export const BANNER_TO_SPEC_SETTLED_CLASS = "layout-banner-to-spec-settled";
export const BANNER_TO_SPEC_NAVBAR_SYNC_CLASS =
    "layout-banner-to-spec-navbar-sync";
export const BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS =
    "layout-banner-to-spec-navbar-commit-freeze";
export const SPEC_TO_BANNER_TRANSITION_CLASS =
    "layout-spec-to-banner-transition";
export const BANNER_TO_SPEC_PROXY_VISIBLE_CLASS =
    "layout-banner-to-spec-proxy-visible";
export const BANNER_TO_SPEC_PROXY_ENTERING_CLASS =
    "layout-banner-to-spec-proxy-entering";
export const BANNER_TO_SPEC_PROXY_REVEALING_CLASS =
    "layout-banner-to-spec-proxy-revealing";
export const BANNER_TO_SPEC_SHIFT_VAR = "--layout-banner-route-up-shift";
export const BANNER_TO_SPEC_BG_OVERSHOOT_VAR =
    "--layout-banner-route-bg-overshoot";
export const BANNER_TO_SPEC_TRANSITION_DURATION_VAR =
    "--layout-banner-route-transition-duration";
export const BANNER_TO_SPEC_VT_DURATION_VAR =
    "--layout-banner-route-vt-duration";
export const BANNER_TO_SPEC_MAIN_PANEL_VT_NAME = "banner-route-main-panel";
export const BANNER_TO_SPEC_PROXY_MODE_ATTR = "data-banner-route-proxy-mode";
export const TRANSITION_PROXY_LAYOUT_ATTR = "data-transition-proxy-layout";
export const ENTER_SKELETON_AWAITING_REPLACE_CLASS =
    "enter-skeleton-awaiting-replace";
export const BANNER_TO_SPEC_TRANSITION_DURATION_MS = 980;
export const BANNER_TO_SPEC_PROXY_ENTER_DURATION_MS = 180;
export const BANNER_TO_SPEC_PROXY_REVEAL_DURATION_MS = 280;
export const ROOT_RUNTIME_CLASSES_TO_PRESERVE = [
    "dark",
    "is-theme-transitioning",
    "use-view-transition",
    "enter-skeleton-active",
    ENTER_SKELETON_AWAITING_REPLACE_CLASS,
    BANNER_TO_SPEC_TRANSITION_CLASS,
    BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS,
    BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS,
    BANNER_TO_SPEC_SETTLED_CLASS,
    BANNER_TO_SPEC_NAVBAR_SYNC_CLASS,
    BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS,
    SPEC_TO_BANNER_TRANSITION_CLASS,
    BANNER_TO_SPEC_PROXY_VISIBLE_CLASS,
    BANNER_TO_SPEC_PROXY_ENTERING_CLASS,
    BANNER_TO_SPEC_PROXY_REVEALING_CLASS,
] as const;
export const ROOT_RUNTIME_STYLE_PROPERTIES_TO_PRESERVE = [
    "font-size",
    "--hue",
    "--banner-height-extend",
    BANNER_TO_SPEC_SHIFT_VAR,
    BANNER_TO_SPEC_BG_OVERSHOOT_VAR,
    BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
] as const;
export const ROOT_RUNTIME_DATA_ATTRIBUTES_TO_PRESERVE = [
    "data-desktop-unsupported",
    "data-desktop-force-browse",
    "data-enter-skeleton-mode",
    "data-nav-phase",
    BANNER_TO_SPEC_PROXY_MODE_ATTR,
    TRANSITION_PROXY_LAYOUT_ATTR,
] as const;

export type BannerWaveLayerSnapshot = {
    currentTimeMs: number | null;
    durationMs: number | null;
};

export type BannerWaveAnimationSnapshot = {
    layers: BannerWaveLayerSnapshot[];
};

type BannerToSpecTransitionEligibility = {
    currentIsHome: boolean;
    isTargetHome: boolean;
    body: HTMLElement | null;
    bannerWrapper: HTMLElement | null;
};

// ===== Navigation target / pathname utils =====

export function isCurrentHomeRoute(body: HTMLElement): boolean {
    if (body.dataset.routeHome === "true") {
        return true;
    }
    if (body.dataset.routeHome === "false") {
        return false;
    }
    return body.classList.contains("lg:is-home");
}

export function normalizePathname(pathname: string): string {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized === "" ? "/" : normalized;
}

export function isSameNavigationTarget(from: URL, to: URL): boolean {
    return (
        normalizePathname(from.pathname) === normalizePathname(to.pathname) &&
        from.search === to.search &&
        from.hash === to.hash
    );
}

// ===== Banner shift metrics =====

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
    const collapsedTopPx = parseCssLengthToPx(COLLAPSED_MAIN_PANEL_TOP_VALUE);
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
    backgroundOvershootPx: number;
};

type MainPanelShiftComputationInput = {
    mainPanelTop: number | null;
    targetTop: number;
    sidebarTops: number[];
    sidebarOvershootTolerancePx?: number;
};

export function resolveMainPanelShiftFromViewportPositions(
    input: MainPanelShiftComputationInput,
): number {
    const {
        mainPanelTop,
        targetTop,
        sidebarTops,
        sidebarOvershootTolerancePx = SIDEBAR_OVERSHOOT_TOLERANCE_PX_VALUE,
    } = input;
    if (mainPanelTop === null) {
        return 0;
    }

    const rawMainShift = mainPanelTop - targetTop;
    if (rawMainShift <= 0) {
        return 0;
    }

    const sidebarCap = sidebarTops
        .map((top) => top - (targetTop - sidebarOvershootTolerancePx))
        .reduce<number>(
            (minCap, candidate) => Math.min(minCap, candidate),
            Number.POSITIVE_INFINITY,
        );
    const resolvedShift = Number.isFinite(sidebarCap)
        ? Math.min(rawMainShift, sidebarCap)
        : rawMainShift;
    return Math.max(0, Number(resolvedShift.toFixed(3)));
}

export function resolveBannerToSpecShiftMetricsFromViewportPositions(
    input: MainPanelShiftComputationInput,
): BannerToSpecShiftMetrics {
    const mainPanelShiftPx = resolveMainPanelShiftFromViewportPositions(input);
    if (input.mainPanelTop === null) {
        return {
            mainPanelShiftPx,
            backgroundOvershootPx: 0,
        };
    }

    return {
        mainPanelShiftPx,
        // 背景层需要继续上推到视口顶部，用目标顶边高度作为额外位移。
        backgroundOvershootPx: Math.max(0, Number(input.targetTop.toFixed(3))),
    };
}

export function resolveBannerToSpecShiftMetrics(
    newDocument?: Document,
): BannerToSpecShiftMetrics {
    const targetTop = resolveTargetMainPanelTopPx(newDocument);
    const mainPanelTop = resolveAnchorViewportTop(".main-panel-wrapper");
    const sidebarTops = ["#sidebar", "#right-sidebar-slot"]
        .map((selector) => resolveAnchorViewportTop(selector))
        .filter((top): top is number => typeof top === "number");

    return resolveBannerToSpecShiftMetricsFromViewportPositions({
        mainPanelTop,
        targetTop,
        sidebarTops,
    });
}

function getProxyHost(targetDocument: Document = document): HTMLElement | null {
    return targetDocument.getElementById(
        "main-panel-transition-proxy",
    ) as HTMLElement | null;
}

function getProxyContentTemplate(
    mode: EnterSkeletonMode,
    targetDocument: Document = document,
): HTMLTemplateElement | null {
    const selector = `[data-transition-proxy-template="${mode}"]`;
    return targetDocument.querySelector<HTMLTemplateElement>(selector);
}

function getProxyShellTemplate(
    layoutKey: TransitionProxyLayoutKey,
    targetDocument: Document = document,
): HTMLTemplateElement | null {
    const selector = `[data-transition-proxy-shell="${layoutKey}"]`;
    return targetDocument.querySelector<HTMLTemplateElement>(selector);
}

function clearChildNodes(target: HTMLElement): void {
    while (target.firstChild) {
        target.removeChild(target.firstChild);
    }
}

export function resolveTransitionProxyPayloadFromDocument(
    targetDocument: Document,
    fallbackPathname?: string,
): TransitionProxyPayload {
    const resolvedMode = fallbackPathname
        ? resolveEnterSkeletonModeFromPath(fallbackPathname)
        : "fallback";
    if (
        targetDocument.querySelector('[data-enter-skeleton-page="auth-login"]')
    ) {
        return {
            mode: resolvedMode,
            layoutKey: "sidebar-main",
        };
    }
    if (
        targetDocument.querySelector(
            '[data-enter-skeleton-page="auth-register"]',
        )
    ) {
        return {
            mode: resolvedMode,
            layoutKey: "sidebar-main",
        };
    }
    if (
        targetDocument.documentElement.classList.contains(
            "route-post-editor",
        ) ||
        targetDocument.body.dataset.routePostEditor === "true"
    ) {
        return {
            mode: resolvedMode,
            layoutKey: "full-width-post-editor",
        };
    }
    if (targetDocument.querySelector(".archive-filter-panel")) {
        return {
            mode: resolvedMode,
            layoutKey: "sidebar-main-right-archive",
        };
    }
    if (targetDocument.querySelector(".bangumi-filter-panel")) {
        return {
            mode: resolvedMode,
            layoutKey: "sidebar-main-right-bangumi",
        };
    }
    if (targetDocument.querySelector(".album-filter-panel")) {
        return {
            mode: resolvedMode,
            layoutKey: "sidebar-main-right-albums",
        };
    }
    const rightSidebarSlot =
        targetDocument.getElementById("right-sidebar-slot");
    const hasVisibleRightSidebar = Boolean(
        rightSidebarSlot instanceof HTMLElement &&
        !rightSidebarSlot.classList.contains("hidden") &&
        rightSidebarSlot.children.length > 0,
    );
    return {
        mode: resolvedMode,
        layoutKey: hasVisibleRightSidebar
            ? "sidebar-main-right-default"
            : resolveTransitionProxyLayoutKeyFromPath(
                  fallbackPathname || "/",
                  resolvedMode,
              ),
    };
}

export function applyTransitionProxySkeleton(
    payload: TransitionProxyPayload,
    targetDocument: Document = document,
): boolean {
    const host = getProxyHost(targetDocument);
    if (!(host instanceof HTMLElement)) {
        return false;
    }
    const shellTemplate =
        getProxyShellTemplate(payload.layoutKey, targetDocument) ??
        getProxyShellTemplate("sidebar-main", targetDocument);
    const contentTemplate =
        getProxyContentTemplate(payload.mode, targetDocument) ??
        getProxyContentTemplate("fallback", targetDocument);
    if (
        !(shellTemplate instanceof HTMLTemplateElement) ||
        !(contentTemplate instanceof HTMLTemplateElement)
    ) {
        return false;
    }

    // 代理骨架在当前文档与 incoming 文档之间共用同一份模板来源，
    // 避免点击瞬间和 swap 后各自临时拼装不同骨架而产生闪烁。
    const shellFragment = shellTemplate.content.cloneNode(
        true,
    ) as DocumentFragment;
    const mainSlot = shellFragment.querySelector<HTMLElement>(
        "[data-transition-proxy-main-slot]",
    );
    if (!(mainSlot instanceof HTMLElement)) {
        return false;
    }
    mainSlot.appendChild(contentTemplate.content.cloneNode(true));

    clearChildNodes(host);
    host.appendChild(shellFragment);
    targetDocument.documentElement.setAttribute(
        BANNER_TO_SPEC_PROXY_MODE_ATTR,
        payload.mode,
    );
    targetDocument.documentElement.setAttribute(
        TRANSITION_PROXY_LAYOUT_ATTR,
        payload.layoutKey,
    );
    return true;
}

export function clearTransitionProxySkeleton(
    targetDocument: Document = document,
): void {
    const host = getProxyHost(targetDocument);
    if (host instanceof HTMLElement) {
        clearChildNodes(host);
    }
    targetDocument.documentElement.removeAttribute(
        BANNER_TO_SPEC_PROXY_MODE_ATTR,
    );
    targetDocument.documentElement.removeAttribute(
        TRANSITION_PROXY_LAYOUT_ATTR,
    );
}

export function mountTransitionProxy(
    targetDocument: Document = document,
): void {
    const proxyHost = getProxyHost(targetDocument);
    if (proxyHost instanceof HTMLElement) {
        proxyHost.removeAttribute("hidden");
    }
}

export function startTransitionProxyEnter(
    targetDocument: Document = document,
): void {
    mountTransitionProxy(targetDocument);
    const root = targetDocument.documentElement;
    root.classList.add(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS);
    root.classList.add(BANNER_TO_SPEC_PROXY_ENTERING_CLASS);
    root.classList.remove(BANNER_TO_SPEC_PROXY_REVEALING_CLASS);
}

export function settleTransitionProxyEnter(
    targetDocument: Document = document,
): void {
    targetDocument.documentElement.classList.remove(
        BANNER_TO_SPEC_PROXY_ENTERING_CLASS,
    );
}

export function startTransitionProxyReveal(
    targetDocument: Document = document,
): void {
    mountTransitionProxy(targetDocument);
    const root = targetDocument.documentElement;
    root.classList.remove(BANNER_TO_SPEC_PROXY_ENTERING_CLASS);
    root.classList.add(BANNER_TO_SPEC_PROXY_REVEALING_CLASS);
    root.classList.add(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS);
}

// ===== DOM helpers =====

function parseAnimationTimeMs(timeValue: string): number | null {
    const [firstSegment = ""] = timeValue.split(",", 1);
    const trimmed = firstSegment.trim();
    if (!trimmed) {
        return null;
    }
    const numericValue = Number.parseFloat(trimmed);
    if (!Number.isFinite(numericValue)) {
        return null;
    }
    if (trimmed.endsWith("ms")) {
        return numericValue;
    }
    if (trimmed.endsWith("s")) {
        return numericValue * 1000;
    }
    return null;
}

export function captureBannerWaveAnimationSnapshot(
    sourceDocument: Document = document,
): BannerWaveAnimationSnapshot | null {
    const waveUses = Array.from(
        sourceDocument.querySelectorAll<SVGUseElement>("#header-waves use"),
    );
    if (waveUses.length === 0) {
        return null;
    }

    return {
        layers: waveUses.map((waveUse) => {
            const animation = waveUse.getAnimations()[0];
            const currentTime = animation?.currentTime;
            const timing = animation?.effect?.getTiming();
            const durationFromEffect =
                typeof timing?.duration === "number" &&
                Number.isFinite(timing.duration)
                    ? timing.duration
                    : null;
            const duration =
                durationFromEffect ??
                parseAnimationTimeMs(waveUse.style.animationDuration);
            const delayMs = parseAnimationTimeMs(waveUse.style.animationDelay);
            const currentTimeMs =
                typeof currentTime === "number" && Number.isFinite(currentTime)
                    ? currentTime
                    : delayMs !== null && delayMs < 0
                      ? Math.abs(delayMs)
                      : null;
            return {
                currentTimeMs,
                durationMs: duration,
            };
        }),
    };
}

function normalizeAnimationPhaseMs(
    currentTimeMs: number,
    durationMs: number,
): number {
    if (durationMs <= 0) {
        return 0;
    }
    const normalized = currentTimeMs % durationMs;
    return normalized >= 0 ? normalized : normalized + durationMs;
}

function primeWaveGroupFromSnapshot(
    selector: string,
    snapshot: BannerWaveAnimationSnapshot,
    targetDocument: Document,
): void {
    const waveUses = Array.from(
        targetDocument.querySelectorAll<SVGUseElement>(selector),
    );
    waveUses.forEach((waveUse, index) => {
        const layer = snapshot.layers[index];
        if (
            !layer ||
            layer.currentTimeMs === null ||
            layer.durationMs === null ||
            layer.durationMs <= 0
        ) {
            return;
        }

        const normalizedPhaseMs = normalizeAnimationPhaseMs(
            layer.currentTimeMs,
            layer.durationMs,
        );
        // 在 incoming 文档首帧前直接改写 CSS 动画 timing，
        // 让新建 DOM 第一次绘制就落在旧页面同一相位上。
        waveUse.style.animationDuration = `${layer.durationMs}ms`;
        waveUse.style.animationDelay = `${-normalizedPhaseMs}ms`;
        waveUse.style.animationPlayState = "running";
    });
}

export function primeBannerWaveAnimationSnapshot(
    snapshot: BannerWaveAnimationSnapshot | null,
    targetDocument: Document,
): void {
    if (!snapshot) {
        return;
    }
    primeWaveGroupFromSnapshot("#header-waves use", snapshot, targetDocument);
    primeWaveGroupFromSnapshot(
        ".main-panel-transition-bg-wave use",
        snapshot,
        targetDocument,
    );
}

export function applyBannerWaveAnimationSnapshot(
    snapshot: BannerWaveAnimationSnapshot | null,
    targetDocument: Document = document,
): void {
    if (!snapshot) {
        return;
    }

    const syncWaveGroup = (selector: string): void => {
        const waveUses = Array.from(
            targetDocument.querySelectorAll<SVGUseElement>(selector),
        );
        waveUses.forEach((waveUse, index) => {
            const layer = snapshot.layers[index];
            if (!layer || layer.currentTimeMs === null) {
                return;
            }

            const animation = waveUse.getAnimations()[0];
            if (animation) {
                animation.currentTime = layer.currentTimeMs;
            }
        });
    };

    syncWaveGroup("#header-waves use");
    syncWaveGroup(".main-panel-transition-bg-wave use");
}

export function stripOnloadAnimationClasses(scope: HTMLElement): void {
    scope.classList.remove("onload-animation");
    const animatedElements =
        scope.querySelectorAll<HTMLElement>(".onload-animation");
    animatedElements.forEach((element) => {
        element.classList.remove("onload-animation");
        element.style.removeProperty("animation-delay");
    });
}

export function setBannerToSpecViewTransitionNames(scope: ParentNode): void {
    const mainPanel = scope.querySelector<HTMLElement>(".main-panel-wrapper");
    if (mainPanel) {
        mainPanel.style.setProperty(
            "view-transition-name",
            BANNER_TO_SPEC_MAIN_PANEL_VT_NAME,
        );
    }
}

export function clearBannerToSpecViewTransitionNames(scope: ParentNode): void {
    const mainPanel = scope.querySelector<HTMLElement>(".main-panel-wrapper");
    if (mainPanel) {
        mainPanel.style.removeProperty("view-transition-name");
    }
}

export function bridgeCurrentBannerToIncomingDocument(
    newDocument: Document,
    currentDocument: Document = document,
): boolean {
    const currentBanner = currentDocument.getElementById("banner-wrapper");
    const incomingBanner = newDocument.getElementById("banner-wrapper");
    if (
        !(currentBanner instanceof HTMLElement) ||
        !(incomingBanner instanceof HTMLElement)
    ) {
        return false;
    }

    // 默认 swap 真正提交前，先把当前 banner 克隆进 incoming 文档，
    // 避免 placeholder banner 在 swap 起始帧短暂露出。
    const bridgedBanner = currentBanner.cloneNode(true);
    incomingBanner.replaceWith(bridgedBanner);
    return true;
}

export function shouldStartBannerToSpecTransition(
    eligibility: BannerToSpecTransitionEligibility,
): boolean {
    const { currentIsHome, isTargetHome, body, bannerWrapper } = eligibility;
    if (
        !currentIsHome ||
        isTargetHome ||
        !(body instanceof HTMLElement) ||
        !(bannerWrapper instanceof HTMLElement)
    ) {
        return false;
    }

    if (body.dataset.layoutMode !== "banner") {
        return false;
    }

    return !bannerWrapper.classList.contains("wallpaper-layer-hidden");
}

export function freezeSpecLayoutStateForHomeDocument(
    targetDocument: Document = document,
): void {
    const body = targetDocument.body;
    if (!(body instanceof HTMLElement)) {
        return;
    }
    body.dataset.layoutMode = "none";
    body.dataset.routeHome = "false";
    body.classList.remove("lg:is-home");
    body.classList.remove("enable-banner");
    body.classList.remove("scroll-collapsed-banner");
    body.classList.add("no-banner-mode");
    body.classList.add("waves-paused");
}

export function primeBannerLayoutStateForIncomingDocument(
    targetDocument: Document,
): void {
    const body = targetDocument.body;
    if (!(body instanceof HTMLElement)) {
        return;
    }

    body.dataset.layoutMode = "banner";
    body.dataset.routeHome = "true";
    body.classList.add("lg:is-home");
    body.classList.add("enable-banner");
    body.classList.remove("no-banner-mode");
    body.classList.remove("waves-paused");
    body.classList.remove("scroll-collapsed-banner");

    const bannerWrapper = targetDocument.getElementById("banner-wrapper");
    if (bannerWrapper instanceof HTMLElement) {
        bannerWrapper.classList.remove("wallpaper-layer-hidden");
        bannerWrapper.removeAttribute("aria-hidden");
        bannerWrapper.removeAttribute("inert");
    }
}

export function applyBannerToSpecShiftVariables(
    newDocument?: Document,
    root: HTMLElement = document.documentElement,
): void {
    const { mainPanelShiftPx, backgroundOvershootPx } =
        resolveBannerToSpecShiftMetrics(newDocument);
    root.style.setProperty(BANNER_TO_SPEC_SHIFT_VAR, `${mainPanelShiftPx}px`);
    root.style.setProperty(
        BANNER_TO_SPEC_BG_OVERSHOOT_VAR,
        `${backgroundOvershootPx}px`,
    );
}

export function prepareIncomingBannerToSpecDocument(
    targetDocument: Document,
): void {
    const root = targetDocument.documentElement;
    root.classList.add(BANNER_TO_SPEC_TRANSITION_CLASS);
    root.classList.add(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
    root.classList.remove(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
    root.classList.remove(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
    root.style.setProperty(
        BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
        `${BANNER_TO_SPEC_TRANSITION_DURATION_MS}ms`,
    );
    root.style.removeProperty(BANNER_TO_SPEC_VT_DURATION_VAR);
    applyBannerToSpecShiftVariables(targetDocument, root);
    primeBannerLayoutStateForIncomingDocument(targetDocument);
}

export function setPageHeightExtendVisible(visible: boolean): void {
    const heightExtend = document.getElementById("page-height-extend");
    if (!heightExtend) {
        return;
    }
    heightExtend.classList.toggle("hidden", !visible);
}

export function setAwaitingReplaceState(isAwaiting: boolean): void {
    document.documentElement.classList.toggle(
        ENTER_SKELETON_AWAITING_REPLACE_CLASS,
        isAwaiting,
    );
}

export function resolveExpectedThemeState(
    defaultTheme: string,
    darkMode: string,
): { isDark: boolean; codeTheme: "github-dark" | "github-light" } {
    const storedTheme = localStorage.getItem("theme") || defaultTheme;
    const isDark = storedTheme === darkMode;
    return { isDark, codeTheme: isDark ? "github-dark" : "github-light" };
}

export function applyThemeStateToRoot(
    root: HTMLElement,
    state: { isDark: boolean; codeTheme: "github-dark" | "github-light" },
): void {
    root.classList.toggle("dark", state.isDark);
    root.setAttribute("data-theme", state.codeTheme);
}

export function syncRootRuntimeStateToIncomingDocument(
    newDocument: Document,
    defaultTheme: string,
    darkMode: string,
): void {
    const currentRoot = document.documentElement;
    const incomingRoot = newDocument.documentElement;
    ROOT_RUNTIME_CLASSES_TO_PRESERVE.forEach((className) => {
        incomingRoot.classList.toggle(
            className,
            currentRoot.classList.contains(className),
        );
    });
    ROOT_RUNTIME_STYLE_PROPERTIES_TO_PRESERVE.forEach((propertyName) => {
        const value = currentRoot.style.getPropertyValue(propertyName);
        if (value.trim().length > 0) {
            incomingRoot.style.setProperty(propertyName, value);
            return;
        }
        incomingRoot.style.removeProperty(propertyName);
    });
    ROOT_RUNTIME_DATA_ATTRIBUTES_TO_PRESERVE.forEach((attributeName) => {
        const value = currentRoot.getAttribute(attributeName);
        if (typeof value === "string") {
            incomingRoot.setAttribute(attributeName, value);
            return;
        }
        incomingRoot.removeAttribute(attributeName);
    });
    applyThemeStateToRoot(
        incomingRoot,
        resolveExpectedThemeState(defaultTheme, darkMode),
    );
}

// ===== Sidebar preservation =====

export type SidebarPreservationResult = {
    shouldPreserveSidebar: boolean;
    patch: SidebarProfilePatch | null;
};

function prepareSidebarForPreservation(
    currentSidebar: HTMLElement,
    newSidebar: HTMLElement,
): void {
    stripOnloadAnimationClasses(currentSidebar);
    currentSidebar.dataset.sidebarPreserved = "";
    const nextScrollable = newSidebar.getAttribute("data-scrollable");
    if (nextScrollable) {
        currentSidebar.setAttribute("data-scrollable", nextScrollable);
    }
}

function isSameUidSidebarLayoutIncompatible(
    currentLayoutKey: string,
    newLayoutKey: string,
    currentUid: string | null,
    newUid: string | null,
): boolean {
    const layoutComparable =
        currentLayoutKey.length > 0 && newLayoutKey.length > 0;
    return (
        Boolean(currentUid) &&
        Boolean(newUid) &&
        currentUid === newUid &&
        layoutComparable &&
        currentLayoutKey !== newLayoutKey
    );
}

export function resolveSidebarPreservation(
    currentSidebar: HTMLElement,
    newSidebar: HTMLElement,
): SidebarPreservationResult {
    const currentUid = currentSidebar.getAttribute("data-sidebar-uid");
    const newUid = newSidebar.getAttribute("data-sidebar-uid");
    const currentLayoutKey =
        currentSidebar.getAttribute("data-sidebar-layout-key") || "";
    const newLayoutKey =
        newSidebar.getAttribute("data-sidebar-layout-key") || "";
    const layoutComparable =
        currentLayoutKey.length > 0 && newLayoutKey.length > 0;
    const sameLayout = layoutComparable && currentLayoutKey === newLayoutKey;
    const nextPatch = extractSidebarProfilePatch(newSidebar);
    const canPatch = sameLayout && nextPatch !== null;
    const bothHaveUid = Boolean(currentUid) && Boolean(newUid);

    if (
        isSameUidSidebarLayoutIncompatible(
            currentLayoutKey,
            newLayoutKey,
            currentUid,
            newUid,
        )
    ) {
        return { shouldPreserveSidebar: false, patch: null };
    }
    if (bothHaveUid && currentUid === newUid) {
        prepareSidebarForPreservation(currentSidebar, newSidebar);
        return {
            shouldPreserveSidebar: true,
            patch: canPatch ? (nextPatch as SidebarProfilePatch) : null,
        };
    }
    if (bothHaveUid && sameLayout && canPatch) {
        prepareSidebarForPreservation(currentSidebar, newSidebar);
        return {
            shouldPreserveSidebar: true,
            patch: nextPatch as SidebarProfilePatch,
        };
    }
    return { shouldPreserveSidebar: false, patch: null };
}

// ===== Transition state =====

export type TransitionIntentDeps = {
    controller: LayoutController;
    defaultTheme: string;
    darkMode: string;
    pathsEqual: (left: string, right: string) => boolean;
    url: (path: string) => string;
};

export type TransitionState = {
    pendingBannerToSpecRoutePath: string | null;
    pendingTransitionProxyRoutePath: string | null;
    pendingSidebarProfilePatch: SidebarProfilePatch | null;
    pendingBannerWaveAnimationSnapshot: BannerWaveAnimationSnapshot | null;
    bannerToSpecAnimationStartedAt: number | null;
    bannerToSpecMotionDurationMs: number;
    transitionProxyMode: EnterSkeletonMode | null;
    transitionProxyLayoutKey: TransitionProxyLayoutKey | null;
    bannerToSpecMotionCompleted: boolean;
    bannerToSpecMotionPromise: Promise<void> | null;
    bannerToSpecMotionResolve: (() => void) | null;
    bannerToSpecMotionTimerId: number | null;
    bannerToSpecLoaderSettled: boolean;
    proxyEnterFrameId: number | null;
    proxyEnterTimerId: number | null;
    proxyRevealTimerId: number | null;
    viewTransitionFinished: Promise<void> | null;
    delayedPageViewTimerId: number | null;
    didReplaceContentDuringVisit: boolean;
    didForceNavbarScrolledForBannerToSpec: boolean;
    pendingSpecToBannerFreeze: boolean;
    navigationInProgress: boolean;
    navigationToken: number;
    lastFinalizedNavigationToken: number | null;
};

export function clearDelayedPageViewTimer(state: TransitionState): void {
    if (state.delayedPageViewTimerId !== null) {
        window.clearTimeout(state.delayedPageViewTimerId);
        state.delayedPageViewTimerId = null;
    }
}

export function clearBannerToSpecMotionTimer(state: TransitionState): void {
    if (state.bannerToSpecMotionTimerId !== null) {
        window.clearTimeout(state.bannerToSpecMotionTimerId);
        state.bannerToSpecMotionTimerId = null;
    }
}

export function clearTransitionProxyEnterFrame(state: TransitionState): void {
    if (state.proxyEnterFrameId !== null) {
        window.cancelAnimationFrame(state.proxyEnterFrameId);
        state.proxyEnterFrameId = null;
    }
}

export function clearTransitionProxyEnterTimer(state: TransitionState): void {
    if (state.proxyEnterTimerId !== null) {
        window.clearTimeout(state.proxyEnterTimerId);
        state.proxyEnterTimerId = null;
    }
}

export function releaseForcedNavbarScrolledState(state: TransitionState): void {
    if (!state.didForceNavbarScrolledForBannerToSpec) {
        return;
    }
    const navbar = document.getElementById("navbar");
    if (navbar instanceof HTMLElement) {
        navbar.classList.remove("scrolled");
    }
    state.didForceNavbarScrolledForBannerToSpec = false;
}

export function getBannerToSpecRemainingMs(state: TransitionState): number {
    if (
        !state.pendingBannerToSpecRoutePath ||
        state.bannerToSpecAnimationStartedAt === null
    ) {
        return 0;
    }
    const elapsedMs = performance.now() - state.bannerToSpecAnimationStartedAt;
    return Math.max(0, state.bannerToSpecMotionDurationMs - elapsedMs);
}

export function markBannerToSpecMotionCompleted(state: TransitionState): void {
    state.bannerToSpecMotionCompleted = true;
    clearBannerToSpecMotionTimer(state);
    state.bannerToSpecMotionResolve?.();
    state.bannerToSpecMotionResolve = null;
    state.bannerToSpecMotionPromise = null;
}

export function clearTransitionProxyVisualState(
    targetDocument: Document = document,
): void {
    clearTransitionProxySkeleton(targetDocument);
    const root = targetDocument.documentElement;
    root.classList.remove(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS);
    root.classList.remove(BANNER_TO_SPEC_PROXY_ENTERING_CLASS);
    root.classList.remove(BANNER_TO_SPEC_PROXY_REVEALING_CLASS);
    const proxyHost = getProxyHost(targetDocument);
    if (proxyHost instanceof HTMLElement) {
        proxyHost.setAttribute("hidden", "");
    }
}

export function clearBannerToSpecTransitionVisualState(
    state: TransitionState,
    options?: { preserveNavbarCommitFreeze?: boolean },
): void {
    clearDelayedPageViewTimer(state);
    clearBannerToSpecMotionTimer(state);
    clearTransitionProxyEnterFrame(state);
    clearTransitionProxyEnterTimer(state);
    if (state.proxyRevealTimerId !== null) {
        window.clearTimeout(state.proxyRevealTimerId);
        state.proxyRevealTimerId = null;
    }
    state.bannerToSpecAnimationStartedAt = null;
    state.bannerToSpecMotionDurationMs = BANNER_TO_SPEC_TRANSITION_DURATION_MS;
    state.bannerToSpecMotionCompleted = false;
    state.bannerToSpecMotionPromise = null;
    state.bannerToSpecMotionResolve = null;
    state.bannerToSpecLoaderSettled = false;
    state.transitionProxyMode = null;
    state.transitionProxyLayoutKey = null;
    state.pendingTransitionProxyRoutePath = null;
    state.viewTransitionFinished = null;
    releaseForcedNavbarScrolledState(state);
    const root = document.documentElement;
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_CLASS);
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
    root.classList.remove(BANNER_TO_SPEC_LIVE_CLASS);
    root.classList.remove(BANNER_TO_SPEC_SETTLED_CLASS);
    root.classList.remove(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
    root.classList.remove(SPEC_TO_BANNER_TRANSITION_CLASS);
    root.classList.remove(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS);
    root.classList.remove(BANNER_TO_SPEC_PROXY_ENTERING_CLASS);
    root.classList.remove(BANNER_TO_SPEC_PROXY_REVEALING_CLASS);
    if (!options?.preserveNavbarCommitFreeze) {
        root.classList.remove(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
    }
    root.style.removeProperty(BANNER_TO_SPEC_SHIFT_VAR);
    root.style.removeProperty(BANNER_TO_SPEC_BG_OVERSHOOT_VAR);
    root.style.removeProperty(BANNER_TO_SPEC_TRANSITION_DURATION_VAR);
    root.style.removeProperty(BANNER_TO_SPEC_VT_DURATION_VAR);
    clearTransitionProxyVisualState();
    setPageHeightExtendVisible(false);
    clearBannerToSpecViewTransitionNames(document);
}

export function startBannerToSpecMoveTransition(state: TransitionState): void {
    if (
        !state.pendingBannerToSpecRoutePath ||
        state.bannerToSpecAnimationStartedAt !== null
    ) {
        return;
    }
    const root = document.documentElement;
    const navbar = document.getElementById("navbar");
    if (
        navbar instanceof HTMLElement &&
        !navbar.classList.contains("scrolled")
    ) {
        navbar.classList.add("scrolled");
        state.didForceNavbarScrolledForBannerToSpec = true;
    }
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
    root.classList.remove(BANNER_TO_SPEC_SETTLED_CLASS);
    root.classList.add(BANNER_TO_SPEC_LIVE_CLASS);
    root.classList.add(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
    const motionDurationMs = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
    ).matches
        ? 0
        : BANNER_TO_SPEC_TRANSITION_DURATION_MS;
    root.style.setProperty(
        BANNER_TO_SPEC_TRANSITION_DURATION_VAR,
        `${motionDurationMs}ms`,
    );
    state.bannerToSpecAnimationStartedAt = performance.now();
    state.bannerToSpecMotionDurationMs = motionDurationMs;
    state.bannerToSpecMotionCompleted = false;
    state.bannerToSpecMotionPromise = new Promise<void>((resolve) => {
        state.bannerToSpecMotionResolve = resolve;
    });
    clearBannerToSpecMotionTimer(state);
    if (motionDurationMs <= 0) {
        markBannerToSpecMotionCompleted(state);
        return;
    }
    state.bannerToSpecMotionTimerId = window.setTimeout(() => {
        markBannerToSpecMotionCompleted(state);
    }, motionDurationMs);
}

export function setIncomingBannerToSpecSettledState(
    targetDocument: Document,
): void {
    const root = targetDocument.documentElement;
    root.classList.add(BANNER_TO_SPEC_TRANSITION_CLASS);
    root.classList.add(BANNER_TO_SPEC_SETTLED_CLASS);
    root.classList.add(BANNER_TO_SPEC_NAVBAR_SYNC_CLASS);
    root.classList.add(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS);
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_PREPARING_CLASS);
    root.classList.remove(BANNER_TO_SPEC_TRANSITION_ACTIVE_CLASS);
    root.classList.remove(BANNER_TO_SPEC_LIVE_CLASS);
}

export function dispatchRouteChangeWithNavbarCommitFreeze(
    state: TransitionState,
    deps: TransitionIntentDeps,
): boolean {
    const routeScrollTop = state.pendingSpecToBannerFreeze
        ? 0
        : document.documentElement.scrollTop;
    const commitRouteChange = (): void => {
        // spec -> home 期间先冻结为 spec 布局，切换提交时需按顶部状态计算，
        // 避免 navbar 在一帧内出现 scrolled -> unscrolled 的闪烁跳变
        deps.controller.dispatch({
            type: "ROUTE_CHANGED",
            path: window.location.pathname,
            scrollTop: routeScrollTop,
            viewportWidth: window.innerWidth,
            reason: "route-change",
        });
    };
    if (
        !state.pendingBannerToSpecRoutePath ||
        state.bannerToSpecAnimationStartedAt === null
    ) {
        commitRouteChange();
        return false;
    }
    const root = document.documentElement;
    const currentNavigationToken = state.navigationToken;
    root.classList.add(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
    commitRouteChange();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (state.navigationToken !== currentNavigationToken) {
                return;
            }
            root.classList.remove(BANNER_TO_SPEC_NAVBAR_COMMIT_FREEZE_CLASS);
        });
    });
    return true;
}

export function applyVtDurationFromElapsed(
    state: TransitionState,
    newDocument: Document,
): void {
    if (
        !state.pendingBannerToSpecRoutePath ||
        state.bannerToSpecAnimationStartedAt === null
    ) {
        return;
    }
    const elapsed = performance.now() - state.bannerToSpecAnimationStartedAt;
    const remaining = Math.max(
        50,
        BANNER_TO_SPEC_TRANSITION_DURATION_MS - elapsed,
    );
    const durationValue = `${Math.ceil(remaining)}ms`;
    document.documentElement.style.setProperty(
        BANNER_TO_SPEC_VT_DURATION_VAR,
        durationValue,
    );
    newDocument.documentElement.style.setProperty(
        BANNER_TO_SPEC_VT_DURATION_VAR,
        durationValue,
    );
}
