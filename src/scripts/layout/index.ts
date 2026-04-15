import "overlayscrollbars/overlayscrollbars.css";
import "@/styles/progress-overlay.css";

import { DARK_MODE, DEFAULT_THEME } from "@/constants/constants";
import { setupCodeCopyDelegation } from "@/scripts/markdown/code-copy";
import { ensureProgressOverlayBridge } from "@/scripts/shared/progress-overlay-manager";
import { initRunningDaysRuntime } from "@/scripts/layout/running-days-runtime";
import {
    encodeHashId,
    resolveSamePageHashLink,
    scrollElementBelowTocBaseline,
    scrollToHashBelowTocBaseline,
} from "@/utils/hash-scroll";
import { initKatexScrollbars } from "@/utils/katex-scrollbar";
import { setupPanelOutsideHandler } from "@/utils/panel-outside-handler";
import { panelManager } from "@/utils/panel-manager.js";
import { pathsEqual, url } from "@/utils/url-utils";
import {
    resetBannerCarousel,
    setupBannerRuntime,
    showBanner,
    updateBannerCarouselState,
} from "./banner-carousel";
import { createFancyboxController } from "./fancybox-init";
import { checkKatex } from "./katex-loader";
import { initLayoutController } from "./layout-controller";
import { syncSidebarAvatarLoadingState } from "./sidebar-profile-sync";
import { setupScrollIntentSource } from "./scroll-ui";
import { setupTransitionIntentSource } from "./transition-hooks";

const BANNER_HEIGHT = 35;
const BANNER_HEIGHT_EXTEND = 30;
const BANNER_HEIGHT_HOME = BANNER_HEIGHT + BANNER_HEIGHT_EXTEND;
const ALBUM_GALLERY_READY_EVENT = "cialli:album-gallery:ready";
const BANNER_TO_SPEC_TRANSITION_CLASS = "layout-banner-to-spec-transition";
const TRANSITION_PROXY_VISIBLE_CLASS = "layout-banner-to-spec-proxy-visible";

type LayoutRuntimeWindow = Window &
    typeof globalThis & {
        __layoutDeferredPageInitPending?: boolean;
        __layoutRuntimeInitialized?: boolean;
        __layoutTransitionHooksAttached?: boolean;
        __layoutHashOffsetBound?: boolean;
        __layoutPageLifecycleBound?: boolean;
    };

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

    // Attach Astro View Transitions hooks
    if (!runtimeWindow.__layoutTransitionHooksAttached) {
        setupTransitionIntentSource({
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
        runtimeWindow.__layoutTransitionHooksAttached = true;
    }

    // Initialize fancybox and katex directly
    void fancyboxController.initFancybox();
    checkKatex();

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

function updateBannerExtendCssVar(): void {
    let extendPx = Math.floor(
        window.innerHeight * (BANNER_HEIGHT_EXTEND / 100),
    );
    extendPx = extendPx - (extendPx % 4);
    document.documentElement.style.setProperty(
        "--banner-height-extend",
        `${extendPx}px`,
    );
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

// ---------------------------------------------------------------------------
// Dynamic page-specific initialization
//
// Some pages (e.g. /me/) have page-specific modules that must re-initialise
// after every navigation.  We register a global listener here (guaranteed to
// be loaded on the very first full page load) and dynamically import the page
// module on demand.
// ---------------------------------------------------------------------------

const runDynamicPageInit = async (): Promise<void> => {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/me") {
        const { initMePage } = await import("@/scripts/me/page");
        initMePage();
    } else if (path === "/posts/new" || /^\/posts\/[^/]+\/edit$/.test(path)) {
        const { initPublishPage } = await import("@/scripts/publish/page");
        initPublishPage();
    } else if (path === "/posts") {
        const { initArchiveFilter } = await import("@/scripts/archives/filter");
        initArchiveFilter();
    } else if (/^\/[^/]+\/albums\/?$/.test(path)) {
        const { initAlbumFilter } = await import("@/scripts/albums/filter");
        initAlbumFilter();
    } else if (/^\/[^/]+\/bangumi\/?$/.test(path)) {
        const { initBangumiFilter } = await import("@/scripts/bangumi/filter");
        initBangumiFilter();
    } else if (/^\/[^/]+\/albums\/new\/?$/.test(path)) {
        const { initAlbumNewPage } = await import("@/scripts/albums/new-page");
        initAlbumNewPage();
    } else if (path === "/admin/settings/site") {
        const { initSiteSettingsPage } =
            await import("@/scripts/site-settings/page");
        initSiteSettingsPage();
    } else if (path === "/admin/users") {
        const { initAdminUsersPage } =
            await import("@/scripts/admin/users-page");
        initAdminUsersPage();
    } else if (path === "/admin/settings/bulletin") {
        const { initAdminBulletinPage } =
            await import("@/scripts/admin/bulletin-page");
        initAdminBulletinPage();
    } else if (path === "/admin/settings/about") {
        const { initAdminAboutPage } =
            await import("@/scripts/admin/about-page");
        initAdminAboutPage();
    } else if (path === "/me/homepage") {
        const { initMeHomepagePage } =
            await import("@/scripts/me/homepage-page");
        initMeHomepagePage();
    }
};

function bindPageLifecycle(runtimeWindow: LayoutRuntimeWindow): void {
    if (runtimeWindow.__layoutPageLifecycleBound) {
        return;
    }

    document.addEventListener("astro:after-swap", () => {
        resetBannerCarousel();
        updateBannerExtendCssVar();
    });

    document.addEventListener("astro:page-load", () => {
        updateBannerExtendCssVar();
        if (
            document.documentElement.classList.contains(
                BANNER_TO_SPEC_TRANSITION_CLASS,
            ) ||
            document.documentElement.classList.contains(
                TRANSITION_PROXY_VISIBLE_CLASS,
            )
        ) {
            runtimeWindow.__layoutDeferredPageInitPending = true;
            return;
        }
        showBanner();
        void runDynamicPageInit();
    });

    document.addEventListener("cialli:navigation:settled", () => {
        if (!runtimeWindow.__layoutDeferredPageInitPending) {
            return;
        }
        runtimeWindow.__layoutDeferredPageInitPending = false;
        showBanner();
        void runDynamicPageInit();
    });

    runtimeWindow.__layoutPageLifecycleBound = true;
}

export function bootstrapLayoutRuntime(): void {
    const runtimeWindow = window as LayoutRuntimeWindow;
    initLayoutRuntime();
    initRunningDaysRuntime();
    bindPageLifecycle(runtimeWindow);
    updateBannerExtendCssVar();
    void runDynamicPageInit();
}
