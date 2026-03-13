export type LayoutMode = "banner" | "collapsed" | "none";

export type LayoutReason =
    | "initial"
    | "route-change"
    | "scroll-update"
    | "scroll-collapse"
    | "logo-click"
    | "expand"
    | "resize";

export type LayoutState = {
    mode: LayoutMode;
    isHome: boolean;
    bannerEnabled: boolean;
    navbarTransparentMode: "semi" | "full" | "semifull";
    scrollTop: number;
    viewportWidth: number;
    reason: LayoutReason;
};

export type LayoutIntent =
    | {
          type: "INIT_PAGE";
          path: string;
          scrollTop: number;
          viewportWidth: number;
          reason?: LayoutReason;
      }
    | {
          type: "ROUTE_CHANGED";
          path: string;
          scrollTop: number;
          viewportWidth: number;
          reason?: LayoutReason;
      }
    | {
          type: "SCROLL_UPDATE";
          scrollTop: number;
          viewportWidth: number;
          reason?: LayoutReason;
      }
    | {
          type: "COLLAPSE_BANNER";
          reason?: LayoutReason;
      }
    | {
          type: "EXPAND_BANNER";
          reason?: LayoutReason;
      }
    | {
          type: "LOGO_CLICK";
      }
    | {
          type: "RESIZE";
          scrollTop: number;
          viewportWidth: number;
          reason?: LayoutReason;
      };

export type LayoutReducerConfig = {
    defaultWallpaperMode: "banner" | "none";
    desktopCollapseMinWidth: number;
};

type InitialStateInput = {
    path: string;
    bannerEnabled: boolean;
    defaultWallpaperMode: "banner" | "none";
    navbarTransparentMode: "semi" | "full" | "semifull";
    scrollTop: number;
    viewportWidth: number;
};

function isHomePath(path: string): boolean {
    const normalized = path.replace(/\/+$/, "") || "/";
    return normalized === "/";
}

function resolveModeForRoute(
    isHome: boolean,
    bannerEnabled: boolean,
    defaultWallpaperMode: "banner" | "none",
): LayoutMode {
    if (!bannerEnabled) {
        return "none";
    }
    if (!isHome) {
        return "none";
    }
    return defaultWallpaperMode === "banner" ? "banner" : "none";
}

export function createInitialLayoutState(
    input: InitialStateInput,
): LayoutState {
    const isHome = isHomePath(input.path);
    return {
        mode: resolveModeForRoute(
            isHome,
            input.bannerEnabled,
            input.defaultWallpaperMode,
        ),
        isHome,
        bannerEnabled: input.bannerEnabled,
        navbarTransparentMode: input.navbarTransparentMode,
        scrollTop: input.scrollTop,
        viewportWidth: input.viewportWidth,
        reason: "initial",
    };
}

function handleInitOrRouteChanged(
    state: LayoutState,
    intent: Extract<LayoutIntent, { type: "INIT_PAGE" | "ROUTE_CHANGED" }>,
    config: LayoutReducerConfig,
): LayoutState {
    const isHome = isHomePath(intent.path);
    return {
        ...state,
        mode: resolveModeForRoute(
            isHome,
            state.bannerEnabled,
            config.defaultWallpaperMode,
        ),
        isHome,
        scrollTop: intent.scrollTop,
        viewportWidth: intent.viewportWidth,
        reason: intent.reason ?? "route-change",
    };
}

function handleScrollUpdate(
    state: LayoutState,
    intent: Extract<LayoutIntent, { type: "SCROLL_UPDATE" }>,
): LayoutState {
    return {
        ...state,
        scrollTop: intent.scrollTop,
        viewportWidth: intent.viewportWidth,
        reason: intent.reason ?? "scroll-update",
    };
}

function handleCollapseBanner(
    state: LayoutState,
    intent: Extract<LayoutIntent, { type: "COLLAPSE_BANNER" }>,
    config: LayoutReducerConfig,
): LayoutState {
    if (
        !state.bannerEnabled ||
        !state.isHome ||
        state.viewportWidth < config.desktopCollapseMinWidth ||
        state.mode !== "banner"
    ) {
        return state;
    }
    return {
        ...state,
        mode: "collapsed",
        reason: intent.reason ?? "scroll-collapse",
    };
}

function handleExpandBanner(
    state: LayoutState,
    intent: Extract<LayoutIntent, { type: "EXPAND_BANNER" }>,
): LayoutState {
    if (!state.bannerEnabled || !state.isHome || state.mode !== "collapsed") {
        return state;
    }
    return {
        ...state,
        mode: "banner",
        reason: intent.reason ?? "expand",
    };
}

function handleLogoClick(state: LayoutState): LayoutState {
    if (!state.bannerEnabled || !state.isHome || state.mode !== "collapsed") {
        return state;
    }
    return {
        ...state,
        mode: "banner",
        reason: "logo-click",
    };
}

function handleResize(
    state: LayoutState,
    intent: Extract<LayoutIntent, { type: "RESIZE" }>,
): LayoutState {
    return {
        ...state,
        scrollTop: intent.scrollTop,
        viewportWidth: intent.viewportWidth,
        reason: intent.reason ?? "resize",
    };
}

export function reduceLayoutState(
    state: LayoutState,
    intent: LayoutIntent,
    config: LayoutReducerConfig,
): LayoutState {
    switch (intent.type) {
        case "INIT_PAGE":
        case "ROUTE_CHANGED":
            return handleInitOrRouteChanged(state, intent, config);
        case "SCROLL_UPDATE":
            return handleScrollUpdate(state, intent);
        case "COLLAPSE_BANNER":
            return handleCollapseBanner(state, intent, config);
        case "EXPAND_BANNER":
            return handleExpandBanner(state, intent);
        case "LOGO_CLICK":
            return handleLogoClick(state);
        case "RESIZE":
            return handleResize(state, intent);
        default:
            return state;
    }
}

export function areLayoutStatesEqual(
    left: LayoutState,
    right: LayoutState,
): boolean {
    return (
        left.mode === right.mode &&
        left.isHome === right.isHome &&
        left.bannerEnabled === right.bannerEnabled &&
        left.navbarTransparentMode === right.navbarTransparentMode &&
        left.scrollTop === right.scrollTop &&
        left.viewportWidth === right.viewportWidth &&
        left.reason === right.reason
    );
}
