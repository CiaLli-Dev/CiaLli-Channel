import { closeMobileEdgeDrawerRoot } from "@/scripts/mobile-edge-drawer";
import { syncMobileFloatStack } from "@/scripts/mobile-float-stack";
import { reinitAllTocInstances } from "@/scripts/toc-runtime";
import {
    collectMarkdownHeadings,
    resolveMarkdownRoot,
} from "@/utils/markdown-toc";
import { calculateReadingProgressPercent } from "@/utils/reading-progress";
import { getTocBaselineOffset } from "@/utils/toc-offset";

type RuntimeWindow = Window &
    typeof globalThis & {
        __cialliMobilePostTocDrawerBound?: boolean;
    };

const ROOT_SELECTOR = "[data-mobile-post-toc-root]";
const LAUNCHER_SELECTOR = "[data-mobile-post-toc-launcher]";
const PROGRESS_SELECTOR = "[data-mobile-post-toc-progress]";
const NAVIGATION_SETTLED_EVENT = "cialli:navigation:settled";
const PASSWORD_CONTENT_READY_EVENT = "cialli:password-content-ready";
const DEFAULT_LAUNCHER_LABEL = "打开文章目录";

let structureSyncFrame = 0;
let progressSyncFrame = 0;
let observedContainer: HTMLElement | null = null;
let contentObserver: MutationObserver | null = null;

function canUseDom(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

function getPostTocDrawerRoots(): HTMLElement[] {
    if (!canUseDom()) {
        return [];
    }
    return Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR));
}

function getTocDepth(): number {
    const depth = window.__CIALLI_RUNTIME_SETTINGS__?.settings.toc.depth;
    if (typeof depth === "number" && Number.isFinite(depth)) {
        return Math.max(1, Math.floor(depth));
    }
    return 3;
}

function hasAvailableTocHeadings(): boolean {
    return collectMarkdownHeadings({ maxDepth: getTocDepth() }).length > 0;
}

function resolveReadingContentElement(): HTMLElement | null {
    const markdownRoot = resolveMarkdownRoot();
    if (markdownRoot instanceof HTMLElement) {
        return markdownRoot;
    }

    const markdownContent = document.querySelector<HTMLElement>(
        "#post-container .markdown-content",
    );
    if (markdownContent instanceof HTMLElement) {
        return markdownContent;
    }

    return document.getElementById("post-container");
}

function resolveObservedContainer(): HTMLElement | null {
    const postContainer = document.getElementById("post-container");
    if (postContainer instanceof HTMLElement) {
        return postContainer;
    }

    const markdownRoot = resolveMarkdownRoot();
    if (markdownRoot instanceof HTMLElement) {
        return markdownRoot;
    }

    return document.getElementById("main-container");
}

function formatProgressLabel(progressPercent: number): string {
    return String(progressPercent);
}

function formatProgressAriaLabel(progressPercent: number): string {
    return `${progressPercent}%`;
}

function getReadingProgressPercent(): number {
    if (!canUseDom()) {
        return 0;
    }

    const contentElement = resolveReadingContentElement();
    if (!(contentElement instanceof HTMLElement)) {
        return 0;
    }

    const scrollY = Math.max(
        window.scrollY || document.documentElement.scrollTop || 0,
        0,
    );
    const rect = contentElement.getBoundingClientRect();
    // 与 TOC 激活区间共用同一条阅读基线，避免按钮百分比和当前章节高亮脱节。
    return calculateReadingProgressPercent({
        baselineY: scrollY + getTocBaselineOffset(),
        contentTop: rect.top + scrollY,
        contentHeight: rect.height,
    });
}

function syncRootProgress(root: HTMLElement, progressPercent: number): void {
    const launcher = root.querySelector<HTMLButtonElement>(LAUNCHER_SELECTOR);
    const progressText = root.querySelector<HTMLElement>(PROGRESS_SELECTOR);
    if (!(launcher instanceof HTMLButtonElement) || !progressText) {
        return;
    }

    const labelText = formatProgressLabel(progressPercent);
    if (progressText.textContent !== labelText) {
        progressText.textContent = labelText;
    }

    const baseLabel =
        launcher.dataset.mobilePostTocBaseLabel?.trim() ||
        launcher.getAttribute("aria-label")?.trim() ||
        DEFAULT_LAUNCHER_LABEL;
    launcher.dataset.mobilePostTocBaseLabel = baseLabel;
    launcher.dataset.mobilePostTocProgressValue = String(progressPercent);
    launcher.setAttribute(
        "aria-label",
        `${baseLabel}，当前阅读进度 ${formatProgressAriaLabel(progressPercent)}`,
    );
}

function syncRootVisibility(root: HTMLElement, visible: boolean): void {
    const nextVisibleFlag = visible ? "1" : "0";
    if (root.dataset.mobilePostTocVisible === nextVisibleFlag) {
        return;
    }

    root.dataset.mobilePostTocVisible = nextVisibleFlag;
    if (!visible) {
        // 目录为空时同时关闭抽屉，避免隐藏后仍然保留遮罩与浮层状态。
        closeMobileEdgeDrawerRoot(root);
        root.hidden = true;
        return;
    }

    root.hidden = false;
    // 抽屉从隐藏恢复时重建 TOC，确保解密后标题也能即时生成目录。
    reinitAllTocInstances(root);
}

function syncMobilePostTocProgress(): void {
    progressSyncFrame = 0;
    if (!canUseDom()) {
        return;
    }

    const roots = getPostTocDrawerRoots();
    if (roots.length === 0) {
        return;
    }

    const progressPercent = getReadingProgressPercent();
    roots.forEach((root) => {
        syncRootProgress(root, progressPercent);
    });
}

function observePostContentChanges(): void {
    if (!canUseDom()) {
        return;
    }

    const nextContainer = resolveObservedContainer();
    if (observedContainer === nextContainer) {
        return;
    }

    contentObserver?.disconnect();
    contentObserver = null;
    observedContainer = nextContainer;

    if (!(nextContainer instanceof HTMLElement)) {
        return;
    }

    contentObserver = new MutationObserver(() => {
        scheduleMobilePostTocSync();
    });
    contentObserver.observe(nextContainer, {
        childList: true,
        subtree: true,
    });
}

function syncMobilePostTocDrawer(): void {
    structureSyncFrame = 0;
    if (!canUseDom()) {
        return;
    }

    observePostContentChanges();

    const roots = getPostTocDrawerRoots();
    if (roots.length === 0) {
        return;
    }

    const visible = hasAvailableTocHeadings();
    const progressPercent = getReadingProgressPercent();
    roots.forEach((root) => {
        syncRootVisibility(root, visible);
        syncRootProgress(root, progressPercent);
    });
    syncMobileFloatStack();
}

function scheduleMobilePostTocSync(): void {
    if (!canUseDom() || structureSyncFrame !== 0) {
        return;
    }
    structureSyncFrame = window.requestAnimationFrame(() => {
        syncMobilePostTocDrawer();
    });
}

function scheduleMobilePostTocProgressSync(): void {
    if (!canUseDom() || progressSyncFrame !== 0) {
        return;
    }
    progressSyncFrame = window.requestAnimationFrame(() => {
        syncMobilePostTocProgress();
    });
}

function bindMobilePostTocDrawer(): void {
    if (!canUseDom()) {
        return;
    }

    const runtimeWindow = window as RuntimeWindow;
    if (runtimeWindow.__cialliMobilePostTocDrawerBound) {
        scheduleMobilePostTocSync();
        return;
    }

    runtimeWindow.__cialliMobilePostTocDrawerBound = true;

    // 进度百分比只需要读滚动位置，不需要每次都重建目录结构。
    window.addEventListener("scroll", scheduleMobilePostTocProgressSync, {
        passive: true,
    });
    window.addEventListener("resize", scheduleMobilePostTocSync, {
        passive: true,
    });
    window.addEventListener(
        PASSWORD_CONTENT_READY_EVENT,
        scheduleMobilePostTocSync,
    );
    document.addEventListener("astro:after-swap", scheduleMobilePostTocSync);
    document.addEventListener(
        NAVIGATION_SETTLED_EVENT,
        scheduleMobilePostTocSync,
    );

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            scheduleMobilePostTocSync,
            {
                once: true,
            },
        );
        return;
    }

    scheduleMobilePostTocSync();
    scheduleMobilePostTocProgressSync();
}

if (canUseDom()) {
    bindMobilePostTocDrawer();
}
