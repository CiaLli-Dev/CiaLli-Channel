import type { MarkdownHeading } from "astro";
import type {
    RuntimeSiteConfig,
    WidgetComponentConfig,
    WidgetComponentType,
} from "@/types/config";
import { cacheManager } from "@/server/cache/manager";
import { createSingleFlightRunner } from "@/server/utils/single-flight";
import { widgetManager } from "@utils/widget-manager";
import { BANNER_HEIGHT_HOME } from "../constants/constants";

export type MainGridLayoutProps = {
    title?: string;
    banner?: string;
    description?: string;
    lang?: string;
    setOGTypeArticle?: boolean;
    headings?: MarkdownHeading[];
    leftSidebarMobilePreset?: LeftSidebarMobilePreset;
    rightSidebarMobilePreset?: RightSidebarMobilePreset;
    hasCustomRightSidebarContent?: boolean;
    pageKind?: string;
};

export type LeftSidebarMobilePreset =
    | "footer"
    | "hidden"
    | "profile-only"
    | "supplementary"
    | "without-announcement"
    | "supplementary-without-announcement";

export type RightSidebarMobilePreset = "panel" | "hidden" | "drawer";

export type SidebarComponentBuckets = {
    topComponents: WidgetComponentConfig[];
    stickyComponents: WidgetComponentConfig[];
};

export type MainGridLayoutState = {
    tocMode: string;
    isFloatTOC: boolean;
    isSidebarTOC: boolean;
    isPostDetailPage: boolean;
    shouldShowPostTocSidebar: boolean;
    isHomePage: boolean;
    isFullWidthPage: boolean;
    isPostEditorPage: boolean;
    showHomeText: boolean;
    initialWallpaperMode: string;
    mainPanelTop: string;
    finalMainPanelTop: string;
    hasLeftSidebarComponents: boolean;
    hasRightSidebarComponents: boolean;
    hasRightSidebarTocWidget: boolean;
    shouldRenderDedicatedPostToc: boolean;
    hasRightSidebarContent: boolean;
    shouldFixRightSidebarSlot: boolean;
    desktopShowLeftSidebar: boolean;
    effectiveShowRightSidebar: boolean;
    desktopShowSidebar: boolean;
    gridCols: string;
    sidebarClass: string;
    rightSidebarClass: string;
    mainContentClass: string;
    hasCarousel: boolean;
    hasCustomRightSidebar: boolean;
    leftSidebarBuckets: SidebarComponentBuckets;
    rightSidebarBuckets: SidebarComponentBuckets;
};

type SidebarPosition = "left" | "right";

type SidebarFilterOptions = {
    includeTypes?: readonly WidgetComponentType[];
    excludeTypes?: readonly WidgetComponentType[];
};

function isHomePagePath(pathname: string): boolean {
    return pathname === "/" || pathname === "";
}

function filterSidebarComponents(
    components: WidgetComponentConfig[],
    options?: SidebarFilterOptions,
): WidgetComponentConfig[] {
    const includeTypes = options?.includeTypes
        ? new Set<WidgetComponentType>(options.includeTypes)
        : null;
    const excludeTypes = options?.excludeTypes
        ? new Set<WidgetComponentType>(options.excludeTypes)
        : null;

    return components.filter((component) => {
        if (includeTypes && !includeTypes.has(component.type)) {
            return false;
        }
        if (excludeTypes && excludeTypes.has(component.type)) {
            return false;
        }
        return true;
    });
}

function applySidebarFilter(
    buckets: SidebarComponentBuckets,
    options?: SidebarFilterOptions,
): SidebarComponentBuckets {
    return {
        topComponents: filterSidebarComponents(buckets.topComponents, options),
        stickyComponents: filterSidebarComponents(
            buckets.stickyComponents,
            options,
        ),
    };
}

export function hasSidebarComponents(
    buckets: SidebarComponentBuckets,
): boolean {
    return (
        buckets.topComponents.length > 0 || buckets.stickyComponents.length > 0
    );
}

export function getSidebarBuckets(
    pathname: string,
    sidebar: SidebarPosition,
): SidebarComponentBuckets {
    const shouldFilterCalendar = !isHomePagePath(pathname);
    const baseFilterOptions: SidebarFilterOptions | undefined =
        shouldFilterCalendar
            ? {
                  excludeTypes: ["calendar"],
              }
            : undefined;

    return {
        topComponents: filterSidebarComponents(
            widgetManager.getComponentsByPosition("top", sidebar),
            baseFilterOptions,
        ),
        stickyComponents: filterSidebarComponents(
            widgetManager.getComponentsByPosition("sticky", sidebar),
            baseFilterOptions,
        ),
    };
}

export function resolveLeftSidebarMobileBuckets(
    sourceBuckets: SidebarComponentBuckets,
    preset: LeftSidebarMobilePreset,
): SidebarComponentBuckets {
    switch (preset) {
        case "profile-only":
            return applySidebarFilter(sourceBuckets, {
                includeTypes: ["profile"],
            });
        case "supplementary":
            return applySidebarFilter(sourceBuckets, {
                excludeTypes: ["profile", "calendar"],
            });
        case "without-announcement":
            return applySidebarFilter(sourceBuckets, {
                excludeTypes: ["announcement"],
            });
        case "supplementary-without-announcement":
            return applySidebarFilter(sourceBuckets, {
                excludeTypes: ["profile", "calendar", "announcement"],
            });
        case "hidden":
            return {
                topComponents: [],
                stickyComponents: [],
            };
        case "footer":
        default:
            return sourceBuckets;
    }
}

export function normalizeBannerList(value: string | string[]): string[] {
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized ? [normalized] : [];
    }
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry || "").trim()).filter(Boolean);
    }
    return [];
}

const BANNER_IMAGES_CACHE_KEY = "default";

const refreshBannerImagesSingleFlight = createSingleFlightRunner(
    async (imageApiUrl: string): Promise<string[]> => {
        const response = await fetch(imageApiUrl);
        const text = await response.text();
        const images = text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
        if (images.length > 0) {
            await cacheManager.set(
                "banner-images",
                BANNER_IMAGES_CACHE_KEY,
                images,
            );
        }
        return images;
    },
    (imageApiUrl: string) => imageApiUrl,
);

function refreshBannerImagesInBackground(imageApiUrl: string): void {
    // banner 外部源只做后台刷新，避免首屏 SSR 等待第三方接口。
    void refreshBannerImagesSingleFlight(imageApiUrl).catch((error) => {
        console.warn(
            "[main-grid-layout] failed to refresh banner images from API:",
            error,
        );
    });
}

export async function getBannerImages(
    runtimeSiteConfig: RuntimeSiteConfig,
): Promise<string[]> {
    const configuredImages = normalizeBannerList(runtimeSiteConfig.banner.src);
    const imageApiUrl = String(
        runtimeSiteConfig.banner.imageApi?.url || "",
    ).trim();
    const shouldRefreshFromApi =
        runtimeSiteConfig.banner.imageApi?.enable === true &&
        imageApiUrl !== "";

    if (shouldRefreshFromApi) {
        refreshBannerImagesInBackground(imageApiUrl);
    }

    if (configuredImages.length > 0) {
        return configuredImages;
    }

    if (shouldRefreshFromApi) {
        const cachedImages = await cacheManager.get<string[]>(
            "banner-images",
            BANNER_IMAGES_CACHE_KEY,
        );
        if (Array.isArray(cachedImages) && cachedImages.length > 0) {
            return normalizeBannerList(cachedImages);
        }
    }

    return [];
}

export function resolveGridCols(
    desktopShowLeftSidebar: boolean,
    effectiveShowRightSidebar: boolean,
): string {
    if (desktopShowLeftSidebar && effectiveShowRightSidebar) {
        return "grid-cols-1 lg:grid-cols-[17.5rem_minmax(0,1fr)_17.5rem]";
    }
    if (desktopShowLeftSidebar) {
        return "grid-cols-1 lg:grid-cols-[17.5rem_minmax(0,1fr)]";
    }
    if (effectiveShowRightSidebar) {
        return "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_17.5rem]";
    }
    return "grid-cols-1";
}

export function resolveRightSidebarClass(
    hasCustomRightSidebar: boolean,
    hasRightSidebarComponents: boolean,
    shouldRenderDedicatedPostToc: boolean,
    desktopShowLeftSidebar: boolean,
): string {
    const colClass = desktopShowLeftSidebar
        ? "lg:col-start-3 lg:col-end-4"
        : "lg:col-start-2 lg:col-end-3";

    const baseClass =
        "onload-animation block w-full min-w-0 order-2 lg:order-none lg:row-start-1 lg:row-end-2 lg:max-w-[17.5rem]";

    if (hasCustomRightSidebar) {
        return `${baseClass} mb-4 ${colClass}`;
    }
    if (hasRightSidebarComponents || shouldRenderDedicatedPostToc) {
        return `${baseClass} overflow-x-hidden mb-4 ${colClass}`;
    }
    return "hidden";
}

export function resolveMainGridPositionClass(
    desktopShowLeftSidebar: boolean,
    effectiveShowRightSidebar: boolean,
): string {
    if (desktopShowLeftSidebar || effectiveShowRightSidebar) {
        return "lg:col-start-2 lg:col-end-3";
    }
    return "lg:col-span-1";
}

type TocState = {
    tocMode: string;
    isFloatTOC: boolean;
    isSidebarTOC: boolean;
    isPostDetailPage: boolean;
    shouldShowPostTocSidebar: boolean;
};

function resolveTocState(
    runtimeSiteConfig: RuntimeSiteConfig,
    pathname: string,
): TocState {
    const tocMode = runtimeSiteConfig.toc.mode || "float";
    const isFloatTOC = tocMode === "float";
    const isSidebarTOC = tocMode === "sidebar";
    const isPostDetailPage = /^\/posts\/[^/]+\/?$/.test(pathname);
    const shouldShowPostTocSidebar =
        runtimeSiteConfig.toc.enable && isSidebarTOC && isPostDetailPage;
    return {
        tocMode,
        isFloatTOC,
        isSidebarTOC,
        isPostDetailPage,
        shouldShowPostTocSidebar,
    };
}

type PageKindState = {
    isHomePage: boolean;
    isFullWidthPage: boolean;
    isPostEditorPage: boolean;
    showHomeText: boolean;
};

function resolvePageKindState(
    runtimeSiteConfig: RuntimeSiteConfig,
    pathname: string,
): PageKindState {
    const isHomePage = isHomePagePath(pathname);
    const normalizedPath = pathname.replace(/\/+$/, "");
    const isPostEditorPage =
        normalizedPath === "/posts/new" ||
        /^\/posts\/[^/]+\/edit$/.test(normalizedPath);
    const isFullWidthPage = isPostEditorPage;
    const showHomeText =
        Boolean(runtimeSiteConfig.banner.homeText?.enable) && isHomePage;
    return {
        isHomePage,
        isFullWidthPage,
        isPostEditorPage,
        showHomeText,
    };
}

type WallpaperPanelState = {
    initialWallpaperMode: string;
    mainPanelTop: string;
    finalMainPanelTop: string;
};

function resolveWallpaperPanelState(
    runtimeSiteConfig: RuntimeSiteConfig,
    isHomePage: boolean,
): WallpaperPanelState {
    const configuredWallpaperMode = runtimeSiteConfig.wallpaperMode.defaultMode;
    const initialWallpaperMode = isHomePage ? configuredWallpaperMode : "none";
    const mainPanelTop =
        initialWallpaperMode === "banner"
            ? `${BANNER_HEIGHT_HOME}vh`
            : "5.5rem";
    const finalMainPanelTop =
        initialWallpaperMode === "banner" ? mainPanelTop : "5.5rem";
    return { initialWallpaperMode, mainPanelTop, finalMainPanelTop };
}

function resolveMainContentClass(
    desktopShowSidebar: boolean,
    desktopShowLeftSidebar: boolean,
    effectiveShowRightSidebar: boolean,
): string {
    const mainGridPositionClass = resolveMainGridPositionClass(
        desktopShowLeftSidebar,
        effectiveShowRightSidebar,
    );
    return `
  transition-fade overflow-clip w-full min-w-0
  order-1 col-span-1 row-start-auto
  lg:order-none lg:row-start-1 lg:row-end-2
  ${desktopShowSidebar ? mainGridPositionClass : "lg:col-span-1"}
`
        .trim()
        .replace(/\s+/g, " ");
}

export function buildMainGridLayoutState(
    runtimeSiteConfig: RuntimeSiteConfig,
    bannerImages: string[],
    pathname: string,
    hasCustomRightSidebar: boolean,
): MainGridLayoutState {
    const {
        tocMode,
        isFloatTOC,
        isSidebarTOC,
        isPostDetailPage,
        shouldShowPostTocSidebar,
    } = resolveTocState(runtimeSiteConfig, pathname);

    const { isHomePage, isFullWidthPage, isPostEditorPage, showHomeText } =
        resolvePageKindState(runtimeSiteConfig, pathname);

    const { initialWallpaperMode, mainPanelTop, finalMainPanelTop } =
        resolveWallpaperPanelState(runtimeSiteConfig, isHomePage);

    const leftSidebarBuckets = getSidebarBuckets(pathname, "left");
    const rightSidebarBuckets = getSidebarBuckets(pathname, "right");
    const hasLeftSidebarComponents = hasSidebarComponents(leftSidebarBuckets);
    const hasRightSidebarComponents = hasSidebarComponents(rightSidebarBuckets);
    const hasRightSidebarTocWidget = [
        ...rightSidebarBuckets.topComponents,
        ...rightSidebarBuckets.stickyComponents,
    ].some((component) => component.type === "toc");

    const shouldRenderDedicatedPostToc =
        shouldShowPostTocSidebar && !hasRightSidebarTocWidget;
    const hasRightSidebarContent =
        hasRightSidebarComponents || shouldRenderDedicatedPostToc;
    const shouldFixRightSidebarSlot =
        shouldRenderDedicatedPostToc || hasCustomRightSidebar;

    const desktopShowLeftSidebar = hasLeftSidebarComponents && !isFullWidthPage;
    const effectiveShowRightSidebar =
        (hasRightSidebarContent || hasCustomRightSidebar) && !isFullWidthPage;
    const desktopShowSidebar =
        hasLeftSidebarComponents || effectiveShowRightSidebar;

    const gridCols = resolveGridCols(
        desktopShowLeftSidebar,
        effectiveShowRightSidebar,
    );
    const sidebarClass = desktopShowLeftSidebar
        ? "onload-animation mb-4 w-full min-w-0 order-3 lg:order-none lg:max-w-[17.5rem] lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-2"
        : "hidden";
    const rightSidebarClass = resolveRightSidebarClass(
        hasCustomRightSidebar,
        hasRightSidebarComponents,
        shouldRenderDedicatedPostToc,
        desktopShowLeftSidebar,
    );

    const mainContentClass = resolveMainContentClass(
        desktopShowSidebar,
        desktopShowLeftSidebar,
        effectiveShowRightSidebar,
    );

    const hasCarousel =
        Boolean(runtimeSiteConfig.banner.carousel?.enable) &&
        Array.isArray(bannerImages) &&
        bannerImages.length > 1;

    return {
        tocMode,
        isFloatTOC,
        isSidebarTOC,
        isPostDetailPage,
        shouldShowPostTocSidebar,
        isHomePage,
        isFullWidthPage,
        isPostEditorPage,
        showHomeText,
        initialWallpaperMode,
        mainPanelTop,
        finalMainPanelTop,
        hasLeftSidebarComponents,
        hasRightSidebarComponents,
        hasRightSidebarTocWidget,
        shouldRenderDedicatedPostToc,
        hasRightSidebarContent,
        shouldFixRightSidebarSlot,
        desktopShowLeftSidebar,
        effectiveShowRightSidebar,
        desktopShowSidebar,
        gridCols,
        sidebarClass,
        rightSidebarClass,
        mainContentClass,
        hasCarousel,
        hasCustomRightSidebar,
        leftSidebarBuckets,
        rightSidebarBuckets,
    };
}
