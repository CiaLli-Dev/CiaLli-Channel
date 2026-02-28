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
    const normalized = pathname.replace(/\/+$/, "");
    return normalized === "" || normalized === "/";
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

    const handleLogoClick = (event: Event): void => {
        if (
            event instanceof MouseEvent &&
            (event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey)
        ) {
            return;
        }

        const eventTarget = event.target;
        if (!(eventTarget instanceof Element)) {
            return;
        }
        const logo = eventTarget.closest<HTMLAnchorElement>("#navbar-logo");
        if (!logo) {
            return;
        }

        // 必须在捕获阶段先于 ClientRouter 拦截首页同地址点击，
        // 否则会先触发 Astro 同 URL 导航，出现“重载”体感与状态重置。
        const onHomeRoute = isHomePath(window.location.pathname);
        if (!onHomeRoute) {
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

    document.addEventListener("click", handleLogoClick, true);

    return {
        dispatch,
        getState: () => state,
        destroy: () => {
            document.removeEventListener("click", handleLogoClick, true);
        },
    };
}
