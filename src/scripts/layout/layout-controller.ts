import {
    applyLayoutState,
    type LayoutDomAdapterDeps,
} from "./layout-dom-adapter";
import {
    areLayoutStatesEqual,
    createInitialLayoutState,
    reduceLayoutState,
    type LayoutIntent,
    type LayoutState,
} from "./layout-state";
import {
    normalizeNavigationPathname,
    shouldIgnoreSamePageNavigation,
} from "./navigation-dedupe";

export type LayoutControllerDeps = {
    bannerEnabled: boolean;
    defaultWallpaperMode: "banner" | "none";
    navbarTransparentMode: "semi" | "full" | "semifull";
    bannerHeight: number;
    bannerHeightHome: number;
    bannerHeightExtend: number;
    updateBannerCarouselState: () => void;
};

export type LayoutController = {
    dispatch: (intent: LayoutIntent) => LayoutState;
    getState: () => LayoutState;
    destroy: () => void;
};

function createDomDeps(deps: LayoutControllerDeps): LayoutDomAdapterDeps {
    return {
        bannerHeight: deps.bannerHeight,
        bannerHeightHome: deps.bannerHeightHome,
        bannerHeightExtend: deps.bannerHeightExtend,
        updateBannerCarouselState: deps.updateBannerCarouselState,
    };
}

function getInitialScrollTop(): number {
    return document.documentElement.scrollTop;
}

function isHomePath(pathname: string): boolean {
    return normalizeNavigationPathname(pathname) === "/";
}

function isModifiedPrimaryClick(event: Event): boolean {
    return (
        event instanceof MouseEvent &&
        (event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey)
    );
}

function resolveAnchorNavigationTarget(
    anchor: HTMLAnchorElement,
    baseUrl: URL,
): URL | null {
    const rawHref = anchor.getAttribute("href");
    if (!rawHref) {
        return null;
    }
    try {
        return new URL(rawHref, baseUrl);
    } catch {
        return null;
    }
}

export function initLayoutController(
    deps: LayoutControllerDeps,
): LayoutController {
    let state = createInitialLayoutState({
        path: window.location.pathname,
        bannerEnabled: deps.bannerEnabled,
        defaultWallpaperMode: deps.defaultWallpaperMode,
        navbarTransparentMode: deps.navbarTransparentMode,
        scrollTop: getInitialScrollTop(),
        viewportWidth: window.innerWidth,
    });

    const domDeps = createDomDeps(deps);
    applyLayoutState(null, state, domDeps);

    const reducerConfig = {
        defaultWallpaperMode: deps.defaultWallpaperMode,
        desktopCollapseMinWidth: 1280,
    };

    const dispatch = (intent: LayoutIntent): LayoutState => {
        const next = reduceLayoutState(state, intent, reducerConfig);
        if (!areLayoutStatesEqual(state, next)) {
            const prev = state;
            state = next;
            applyLayoutState(prev, state, domDeps);
        }
        return state;
    };

    const handleNavigationClick = (event: Event): void => {
        if (isModifiedPrimaryClick(event)) {
            return;
        }

        const eventTarget = event.target;
        if (!(eventTarget instanceof Element)) {
            return;
        }

        const anchor = eventTarget.closest<HTMLAnchorElement>("a[href]");
        if (!anchor) {
            return;
        }

        const isNavbarLogo = anchor.id === "navbar-logo";
        const onHomeRoute = isHomePath(window.location.pathname);

        // 首页 Logo 在首页时保持既有行为
        if (!(isNavbarLogo && onHomeRoute)) {
            const currentUrl = new URL(window.location.href);
            const targetUrl = resolveAnchorNavigationTarget(anchor, currentUrl);
            if (!targetUrl) {
                return;
            }

            // 必须在捕获阶段先于 ClientRouter 拦截“同页同地址”点击，
            // 否则会先触发 Astro 同 URL 导航，出现重复过渡与重载体感
            const shouldIgnore = shouldIgnoreSamePageNavigation({
                currentUrl,
                targetUrl,
                targetAttr: anchor.getAttribute("target"),
                hasDownload: anchor.hasAttribute("download"),
            });
            if (shouldIgnore) {
                event.preventDefault();
            }
            return;
        }

        event.preventDefault();
        const collapsedByDom =
            document.body.dataset.layoutMode === "collapsed" ||
            document.body.classList.contains("scroll-collapsed-banner");
        if (state.mode === "collapsed" || collapsedByDom) {
            dispatch({ type: "LOGO_CLICK" });
            return;
        }

        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    };

    document.addEventListener("click", handleNavigationClick, true);

    return {
        dispatch,
        getState: () => state,
        destroy: () => {
            document.removeEventListener("click", handleNavigationClick, true);
        },
    };
}
