import "overlayscrollbars/overlayscrollbars.css";
import "@/styles/progress-overlay.css";

import { DARK_MODE, DEFAULT_THEME } from "@/constants/constants";
import { setupCodeCopyDelegation } from "@/scripts/code-copy";
import { ensureProgressOverlayBridge } from "@/scripts/progress-overlay-manager";
import { initRunningDaysRuntime } from "@/scripts/running-days-runtime";
import {
    encodeHashId,
    resolveSamePageHashLink,
    scrollElementBelowTocBaseline,
    scrollToHashBelowTocBaseline,
} from "@/utils/hash-scroll";
import { initKatexScrollbars } from "@/utils/katex-scrollbar";
import { setupPanelOutsideHandler } from "@/utils/panel-outside-handler";
import { panelManager } from "@/utils/panel-manager.js";
import { initSakura } from "@/utils/sakura-manager";
import { pathsEqual, url } from "@/utils/url-utils";
import {
    setupBannerRuntime,
    showBanner,
    updateBannerCarouselState,
} from "./banner-carousel";
import { createFancyboxController } from "./fancybox-init";
import { checkKatex } from "./katex-loader";
import { initLayoutController } from "./layout-controller";
import { syncSidebarAvatarLoadingState } from "./sidebar-profile-sync";
import { setupScrollIntentSource } from "./scroll-ui";
import { setupSwupIntentSource } from "./swup-hooks";

const BANNER_HEIGHT = 35;
const BANNER_HEIGHT_EXTEND = 30;
const BANNER_HEIGHT_HOME = BANNER_HEIGHT + BANNER_HEIGHT_EXTEND;
const ALBUM_GALLERY_READY_EVENT = "cialli:album-gallery:ready";

type LayoutRuntimeWindow = Window &
    typeof globalThis & {
        sakuraInitialized?: boolean;
        __layoutRuntimeInitialized?: boolean;
        __layoutSwupHooksAttached?: boolean;
        __layoutHashOffsetBound?: boolean;
        swup?: {
            hooks?: {
                on: (
                    event: string,
                    callback: (...args: never[]) => void,
                ) => void;
            };
            options?: {
                animateHistoryBrowsing?: boolean;
                skipPopStateHandling?: (event: PopStateEvent) => boolean;
            };
        };
    };

type PopStateSkipHandler = (event: PopStateEvent) => boolean;
type PopStateSkipHandlerWithFlag = PopStateSkipHandler & {
    __layoutSkipWrapped?: boolean;
};

function resolveStateUrl(state: unknown): string | null {
    if (!state || typeof state !== "object") {
        return null;
    }

    const stateRecord = state as Record<string, unknown>;
    const stateUrl = stateRecord.url;
    return typeof stateUrl === "string" && stateUrl.trim().length > 0
        ? stateUrl.trim()
        : null;
}

function isHashOnlyHistoryPopState(event: PopStateEvent): boolean {
    const stateUrl = resolveStateUrl(event.state);
    if (!stateUrl) {
        return false;
    }

    try {
        const targetUrl = new URL(stateUrl, window.location.origin);
        const currentUrl = new URL(window.location.href);
        return (
            targetUrl.origin === currentUrl.origin &&
            targetUrl.pathname === currentUrl.pathname &&
            targetUrl.search === currentUrl.search &&
            targetUrl.hash.length > 0
        );
    } catch {
        return stateUrl.includes("#");
    }
}

function ensureSwupHistoryAnimation(
    swup: NonNullable<LayoutRuntimeWindow["swup"]>,
): void {
    const options = (swup.options ??= {});
    options.animateHistoryBrowsing = true;

    const currentSkip = options.skipPopStateHandling as
        | PopStateSkipHandlerWithFlag
        | undefined;
    if (currentSkip?.__layoutSkipWrapped) {
        return;
    }

    const wrappedSkip: PopStateSkipHandlerWithFlag = (
        event: PopStateEvent,
    ): boolean => {
        if (isHashOnlyHistoryPopState(event)) {
            return true;
        }

        if (typeof currentSkip === "function") {
            return currentSkip(event);
        }
        return false;
    };

    wrappedSkip.__layoutSkipWrapped = true;
    options.skipPopStateHandling = wrappedSkip;
}

export function initLayoutRuntime(): void {
    const runtimeWindow = window as LayoutRuntimeWindow;
    if (runtimeWindow.__layoutRuntimeInitialized) {
        return;
    }

    ensureProgressOverlayBridge();
    runtimeWindow.__layoutRuntimeInitialized = true;
    const runtimeSettings = runtimeWindow.__CIALLI_RUNTIME_SETTINGS__;
    const bannerEnabled = Boolean(document.getElementById("banner-wrapper"));
    const fancyboxController = createFancyboxController();
    let albumGalleryReadyFrameHandle: number | null = null;
    const navbarTransparentMode =
        runtimeSettings?.settings.banner?.navbar?.transparentMode || "semi";

    const handleAlbumGalleryReady = () => {
        if (albumGalleryReadyFrameHandle !== null) {
            cancelAnimationFrame(albumGalleryReadyFrameHandle);
        }

        albumGalleryReadyFrameHandle = requestAnimationFrame(() => {
            albumGalleryReadyFrameHandle = null;
            void fancyboxController.initFancybox();
        });
    };

    setupPanelOutsideHandler(panelManager);
    setupCodeCopyDelegation();
    setupBannerRuntime();
    setupHashOffsetNavigation(runtimeWindow);
    syncSidebarAvatarLoadingState(document);
    document.addEventListener(
        ALBUM_GALLERY_READY_EVENT,
        handleAlbumGalleryReady,
    );

    const setupSakura = () => {
        const sakuraConfig = runtimeSettings?.settings.sakura;
        if (!sakuraConfig || !sakuraConfig.enable) {
            return;
        }
        if (runtimeWindow.sakuraInitialized) {
            return;
        }
        initSakura(sakuraConfig);
        runtimeWindow.sakuraInitialized = true;
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupSakura, {
            once: true,
        });
    } else {
        setupSakura();
    }

    const layoutController = initLayoutController({
        bannerEnabled,
        defaultWallpaperMode:
            runtimeSettings?.settings.wallpaperMode.defaultMode || "banner",
        navbarTransparentMode,
        bannerHeight: BANNER_HEIGHT,
        bannerHeightHome: BANNER_HEIGHT_HOME,
        bannerHeightExtend: BANNER_HEIGHT_EXTEND,
        updateBannerCarouselState,
    });

    setupScrollIntentSource({
        controller: layoutController,
        bannerHeight: BANNER_HEIGHT,
        bannerHeightHome: BANNER_HEIGHT_HOME,
        bannerHeightExtend: BANNER_HEIGHT_EXTEND,
    });

    const attachSwupHooks = () => {
        const swup = runtimeWindow.swup;
        if (!swup) {
            return;
        }
        ensureSwupHistoryAnimation(swup);

        if (runtimeWindow.__layoutSwupHooksAttached) {
            return;
        }
        if (!swup.hooks) {
            return;
        }
        setupSwupIntentSource({
            controller: layoutController,
            initFancybox: fancyboxController.initFancybox,
            cleanupFancybox: fancyboxController.cleanupFancybox,
            checkKatex,
            initKatexScrollbars,
            defaultTheme: DEFAULT_THEME,
            darkMode: DARK_MODE,
            pathsEqual,
            url,
        });
        runtimeWindow.__layoutSwupHooksAttached = true;
    };

    if (runtimeWindow.swup?.hooks) {
        void fancyboxController.initFancybox();
        checkKatex();
        attachSwupHooks();
    } else {
        document.addEventListener("swup:enable", attachSwupHooks, {
            once: true,
        });
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                void fancyboxController.initFancybox();
                checkKatex();
            });
        } else {
            void fancyboxController.initFancybox();
            checkKatex();
        }
    }

    const initBannerAndPanels = async () => {
        showBanner();
        try {
            await import("@/utils/panel-manager.js");
        } catch (error) {
            console.error("Failed to initialize panel manager:", error);
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            void initBannerAndPanels();
        });
    } else {
        void initBannerAndPanels();
    }
}

function setupHashOffsetNavigation(runtimeWindow: LayoutRuntimeWindow): void {
    if (runtimeWindow.__layoutHashOffsetBound) {
        return;
    }

    const handleHashAnchorClick = (event: MouseEvent): void => {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const anchor = target.closest<HTMLAnchorElement>("a[href]");
        if (!anchor || anchor.hasAttribute("download")) {
            return;
        }

        const resolvedLink = resolveSamePageHashLink(anchor);
        if (!resolvedLink) {
            return;
        }

        event.preventDefault();

        const nextHash = encodeHashId(resolvedLink.id);
        if (window.location.hash !== nextHash) {
            history.pushState(null, "", nextHash);
        }

        scrollElementBelowTocBaseline(resolvedLink.target, {
            behavior: "smooth",
        });
    };

    const handleHashChange = (): void => {
        if (!window.location.hash) {
            return;
        }

        requestAnimationFrame(() => {
            scrollToHashBelowTocBaseline(window.location.hash, {
                behavior: "instant",
            });
        });
    };

    document.addEventListener("click", handleHashAnchorClick);
    window.addEventListener("hashchange", handleHashChange);

    if (window.location.hash) {
        requestAnimationFrame(() => {
            scrollToHashBelowTocBaseline(window.location.hash, {
                behavior: "instant",
            });
            window.setTimeout(() => {
                scrollToHashBelowTocBaseline(window.location.hash, {
                    behavior: "instant",
                });
            }, 120);
        });
    }

    runtimeWindow.__layoutHashOffsetBound = true;
}

initLayoutRuntime();
initRunningDaysRuntime();

// ---------------------------------------------------------------------------
// Dynamic page-specific initialization
//
// Some pages (e.g. /me/) have page-specific modules that must re-initialise
// after every Swup navigation.  We cannot rely on SwupHeadPlugin to inject
// and execute a new <script type="module"> during Swup transitions — ES
// modules only execute once per URL per document.
//
// Instead, we register a global listener here (guaranteed to be loaded on
// the very first full page load) and dynamically import the page module on
// demand.
// ---------------------------------------------------------------------------

const runDynamicPageInit = async (): Promise<void> => {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/me") {
        const { initMePage } = await import("@/scripts/me-page");
        initMePage();
    } else if (path === "/posts/new" || /^\/posts\/[^/]+\/edit$/.test(path)) {
        const { initPublishPage } = await import("@/scripts/publish-page");
        initPublishPage();
    } else if (path === "/posts") {
        const { initArchiveFilter } = await import("@/scripts/archive-filter");
        initArchiveFilter();
    } else if (/^\/[^/]+\/albums\/?$/.test(path)) {
        const { initAlbumFilter } = await import("@/scripts/album-filter");
        initAlbumFilter();
    } else if (/^\/[^/]+\/bangumi\/?$/.test(path)) {
        const { initBangumiFilter } = await import("@/scripts/bangumi-filter");
        initBangumiFilter();
    } else if (/^\/[^/]+\/albums\/new\/?$/.test(path)) {
        const { initAlbumNewPage } = await import("@/scripts/album-new-page");
        initAlbumNewPage();
    } else if (path === "/admin/settings/site") {
        const { initSiteSettingsPage } =
            await import("@/scripts/site-settings-page");
        initSiteSettingsPage();
    } else if (path === "/admin/users") {
        const { initAdminUsersPage } =
            await import("@/scripts/admin-users-page");
        initAdminUsersPage();
    } else if (path === "/admin/settings/bulletin") {
        const { initAdminBulletinPage } =
            await import("@/scripts/admin-bulletin-page");
        initAdminBulletinPage();
    } else if (path === "/admin/settings/about") {
        const { initAdminAboutPage } =
            await import("@/scripts/admin-about-page");
        initAdminAboutPage();
    } else if (path === "/me/homepage") {
        const { initMeHomepagePage } =
            await import("@/scripts/me-homepage-page");
        initMeHomepagePage();
    }
};

void runDynamicPageInit();
document.addEventListener("astro:after-swap", () => void runDynamicPageInit());
