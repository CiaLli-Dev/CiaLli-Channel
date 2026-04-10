type RuntimeWindow = Window &
    typeof globalThis & {
        __cialliMobileFloatStackBound?: boolean;
        cialliSyncMobileFloatStack?: () => void;
    };

const LAUNCHER_SELECTOR = "[data-mobile-float-launcher]";
const MOBILE_MEDIA_QUERY = "(max-width: 1279px)";

function canUseDom(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

function isLauncherVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        element.hasAttribute("hidden")
    ) {
        return false;
    }
    return element.getClientRects().length > 0;
}

function clearLauncherIndex(element: HTMLElement): void {
    element.style.removeProperty("--mobile-float-index");
}

export function syncMobileFloatStack(): void {
    if (!canUseDom()) {
        return;
    }

    const root = document.documentElement;
    const launchers = Array.from(
        document.querySelectorAll<HTMLElement>(LAUNCHER_SELECTOR),
    );

    if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
        launchers.forEach((launcher) => clearLauncherIndex(launcher));
        root.style.setProperty("--mobile-float-launcher-count", "0");
        return;
    }

    const visibleLaunchers = launchers
        .filter((launcher) => isLauncherVisible(launcher))
        .sort((a, b) => {
            const orderA = Number.parseInt(
                a.dataset.mobileFloatOrder || "0",
                10,
            );
            const orderB = Number.parseInt(
                b.dataset.mobileFloatOrder || "0",
                10,
            );
            return orderA - orderB;
        });

    launchers.forEach((launcher) => clearLauncherIndex(launcher));
    visibleLaunchers.forEach((launcher, index) => {
        launcher.style.setProperty("--mobile-float-index", String(index));
    });
    root.style.setProperty(
        "--mobile-float-launcher-count",
        String(visibleLaunchers.length),
    );
}

function bindMobileFloatStack(): void {
    if (!canUseDom()) {
        return;
    }

    const runtimeWindow = window as RuntimeWindow;
    if (runtimeWindow.__cialliMobileFloatStackBound) {
        runtimeWindow.cialliSyncMobileFloatStack?.();
        return;
    }

    runtimeWindow.__cialliMobileFloatStackBound = true;
    runtimeWindow.cialliSyncMobileFloatStack = syncMobileFloatStack;

    const scheduleSync = (): void => {
        window.requestAnimationFrame(() => {
            syncMobileFloatStack();
        });
    };

    window.addEventListener("resize", scheduleSync, { passive: true });
    document.addEventListener("astro:after-swap", scheduleSync);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", scheduleSync, {
            once: true,
        });
        return;
    }

    scheduleSync();
}

if (canUseDom()) {
    bindMobileFloatStack();
}
