import { syncMobileFloatStack } from "@/scripts/layout/mobile-float-stack";
import { reinitAllTocInstances } from "@/scripts/toc/runtime";

type RuntimeWindow = Window &
    typeof globalThis & {
        __cialliMobileEdgeDrawerBound?: boolean;
        cialliCloseAllMobileEdgeDrawers?: () => void;
    };

const ROOT_SELECTOR = "[data-mobile-edge-drawer-root]";
const TOGGLE_SELECTOR = "[data-mobile-edge-drawer-toggle]";
const PANEL_SELECTOR = "[data-mobile-edge-drawer-panel]";
const BACKDROP_SELECTOR = "[data-mobile-edge-drawer-backdrop]";
const CLOSE_SELECTOR = "[data-mobile-edge-drawer-close]";
const OPEN_CLASS = "is-open";
const MOBILE_MEDIA_QUERY = "(max-width: 1279px)";
export const MOBILE_EDGE_DRAWER_OPEN_EVENT = "cialli:mobile-edge-drawer:open";

function canUseDom(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

function resolveEventElement(event: Event): Element | null {
    return event.target instanceof Element ? event.target : null;
}

function isMobileViewport(): boolean {
    if (!canUseDom()) {
        return false;
    }
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function getDrawerRoots(): HTMLElement[] {
    if (!canUseDom()) {
        return [];
    }
    return Array.from(document.querySelectorAll<HTMLElement>(ROOT_SELECTOR));
}

function getDrawerRoot(element: HTMLElement): HTMLElement | null {
    return element.matches(ROOT_SELECTOR)
        ? element
        : element.closest<HTMLElement>(ROOT_SELECTOR);
}

function syncDrawerAria(root: HTMLElement, open: boolean): void {
    const toggle = root.querySelector<HTMLButtonElement>(TOGGLE_SELECTOR);
    const panel = root.querySelector<HTMLElement>(PANEL_SELECTOR);

    if (toggle) {
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (panel) {
        panel.setAttribute("aria-hidden", open ? "false" : "true");
    }
}

function syncGlobalOpenState(): void {
    if (!canUseDom()) {
        return;
    }
    const hasOpenDrawer = getDrawerRoots().some((root) =>
        root.classList.contains(OPEN_CLASS),
    );
    document.documentElement.classList.toggle(
        "mobile-edge-drawer-open",
        hasOpenDrawer,
    );
}

export function closeMobileEdgeDrawerRoot(target: HTMLElement): void {
    if (!canUseDom()) {
        return;
    }
    const root = getDrawerRoot(target);
    if (!root) {
        return;
    }
    root.classList.remove(OPEN_CLASS);
    syncDrawerAria(root, false);
    syncGlobalOpenState();
    syncMobileFloatStack();
}

export function closeAllMobileEdgeDrawers(): void {
    if (!canUseDom()) {
        return;
    }
    getDrawerRoots().forEach((root) => {
        root.classList.remove(OPEN_CLASS);
        syncDrawerAria(root, false);
    });
    syncGlobalOpenState();
    syncMobileFloatStack();
}

function openMobileEdgeDrawerRoot(root: HTMLElement): void {
    if (!canUseDom()) {
        return;
    }
    if (!isMobileViewport()) {
        closeAllMobileEdgeDrawers();
        return;
    }

    getDrawerRoots().forEach((candidate) => {
        const shouldOpen = candidate === root;
        candidate.classList.toggle(OPEN_CLASS, shouldOpen);
        syncDrawerAria(candidate, shouldOpen);
    });

    syncGlobalOpenState();
    syncMobileFloatStack();
    // 抽屉打开后再按最终尺寸重算其中的 TOC，避免关闭态初始化导致可视区异常。
    window.requestAnimationFrame(() => {
        if (!root.classList.contains(OPEN_CLASS)) {
            return;
        }
        reinitAllTocInstances(root);
    });
    document.dispatchEvent(new CustomEvent(MOBILE_EDGE_DRAWER_OPEN_EVENT));
}

function bindDrawerRoot(root: HTMLElement): void {
    if (!canUseDom()) {
        return;
    }
    if (root.dataset.mobileEdgeDrawerBound === "1") {
        syncDrawerAria(root, root.classList.contains(OPEN_CLASS));
        return;
    }

    root.dataset.mobileEdgeDrawerBound = "1";
    syncDrawerAria(root, root.classList.contains(OPEN_CLASS));
}

function initMobileEdgeDrawers(): void {
    if (!canUseDom()) {
        return;
    }
    getDrawerRoots().forEach((root) => bindDrawerRoot(root));
    syncGlobalOpenState();
    syncMobileFloatStack();
}

function bindMobileEdgeDrawerBootstrap(): void {
    if (!canUseDom()) {
        return;
    }

    const runtimeWindow = window as RuntimeWindow;
    if (runtimeWindow.__cialliMobileEdgeDrawerBound) {
        initMobileEdgeDrawers();
        return;
    }

    runtimeWindow.__cialliMobileEdgeDrawerBound = true;
    runtimeWindow.cialliCloseAllMobileEdgeDrawers = closeAllMobileEdgeDrawers;

    document.addEventListener("click", (event) => {
        const target = resolveEventElement(event);
        if (!target) {
            return;
        }

        const toggle = target.closest<HTMLElement>(TOGGLE_SELECTOR);
        if (toggle) {
            event.preventDefault();
            const root = getDrawerRoot(toggle);
            if (!root) {
                return;
            }
            const isOpen = root.classList.contains(OPEN_CLASS);
            if (isOpen) {
                closeMobileEdgeDrawerRoot(root);
            } else {
                openMobileEdgeDrawerRoot(root);
            }
            return;
        }

        if (
            target.closest<HTMLElement>(BACKDROP_SELECTOR) ||
            target.closest<HTMLElement>(CLOSE_SELECTOR)
        ) {
            event.preventDefault();
            const root =
                target.closest<HTMLElement>(ROOT_SELECTOR) ??
                target.closest<HTMLElement>(PANEL_SELECTOR) ??
                target.closest<HTMLElement>(BACKDROP_SELECTOR) ??
                target.closest<HTMLElement>(CLOSE_SELECTOR);
            if (!root) {
                return;
            }
            closeMobileEdgeDrawerRoot(root);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeAllMobileEdgeDrawers();
        }
    });

    window.addEventListener(
        "resize",
        () => {
            if (!isMobileViewport()) {
                closeAllMobileEdgeDrawers();
            }
            initMobileEdgeDrawers();
        },
        { passive: true },
    );

    document.addEventListener("astro:after-swap", () => {
        closeAllMobileEdgeDrawers();
        initMobileEdgeDrawers();
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initMobileEdgeDrawers, {
            once: true,
        });
        return;
    }

    initMobileEdgeDrawers();
}

if (canUseDom()) {
    bindMobileEdgeDrawerBootstrap();
}
