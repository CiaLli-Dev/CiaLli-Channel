import type { MarkdownHeading } from "astro";
import type { SiteConfig } from "@/types/config";
import { widgetManager } from "@utils/widget-manager";
import { BANNER_HEIGHT_HOME } from "../constants/constants";

export type MainGridLayoutProps = {
    title?: string;
    banner?: string;
    description?: string;
    lang?: string;
    setOGTypeArticle?: boolean;
    headings?: MarkdownHeading[];
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
};

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

export async function getBannerImages(
    siteConfig: SiteConfig,
): Promise<string[]> {
    let bannerSrc = siteConfig.banner.src;

    if (siteConfig.banner.imageApi?.enable && siteConfig.banner.imageApi?.url) {
        try {
            const response = await fetch(siteConfig.banner.imageApi.url);
            const text = await response.text();
            const apiImages = text
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);

            if (apiImages.length > 0) {
                bannerSrc = apiImages;
            }
        } catch (error) {
            console.warn(
                "[main-grid-layout] failed to fetch images from API:",
                error,
            );
        }
    }

    return normalizeBannerList(bannerSrc);
}

export function resolveGridCols(
    desktopShowLeftSidebar: boolean,
    effectiveShowRightSidebar: boolean,
): string {
    if (desktopShowLeftSidebar && effectiveShowRightSidebar) {
        return "grid-cols-[17.5rem_minmax(0,1fr)_17.5rem]";
    }
    if (desktopShowLeftSidebar) {
        return "grid-cols-[17.5rem_minmax(0,1fr)]";
    }
    if (effectiveShowRightSidebar) {
        return "grid-cols-[minmax(0,1fr)_17.5rem]";
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
        ? "col-start-3 col-end-4"
        : "col-start-2 col-end-3";

    if (hasCustomRightSidebar) {
        return `onload-animation block mb-4 max-w-[17.5rem] row-start-1 row-end-2 ${colClass}`;
    }
    if (hasRightSidebarComponents || shouldRenderDedicatedPostToc) {
        return `onload-animation block overflow-x-hidden mb-4 max-w-[17.5rem] row-start-1 row-end-2 ${colClass}`;
    }
    return "hidden";
}

export function resolveMainGridPositionClass(
    desktopShowLeftSidebar: boolean,
    effectiveShowRightSidebar: boolean,
): string {
    if (desktopShowLeftSidebar || effectiveShowRightSidebar) {
        return "col-start-2 col-end-3";
    }
    return "col-span-1";
}

type TocState = {
    tocMode: string;
    isFloatTOC: boolean;
    isSidebarTOC: boolean;
    isPostDetailPage: boolean;
    shouldShowPostTocSidebar: boolean;
};

function resolveTocState(siteConfig: SiteConfig, pathname: string): TocState {
    const tocMode = siteConfig.toc.mode || "float";
    const isFloatTOC = tocMode === "float";
    const isSidebarTOC = tocMode === "sidebar";
    const isPostDetailPage = /^\/posts\/[^/]+\/?$/.test(pathname);
    const shouldShowPostTocSidebar =
        siteConfig.toc.enable && isSidebarTOC && isPostDetailPage;
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
    siteConfig: SiteConfig,
    pathname: string,
): PageKindState {
    const isHomePage = pathname === "/" || pathname === "";
    const normalizedPath = pathname.replace(/\/+$/, "");
    const isPostEditorPage =
        normalizedPath === "/posts/new" ||
        /^\/posts\/[^/]+\/edit$/.test(normalizedPath);
    const isFullWidthPage = isPostEditorPage;
    const showHomeText =
        Boolean(siteConfig.banner.homeText?.enable) && isHomePage;
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
    siteConfig: SiteConfig,
    isHomePage: boolean,
): WallpaperPanelState {
    const configuredWallpaperMode = siteConfig.wallpaperMode.defaultMode;
    const initialWallpaperMode = isHomePage ? configuredWallpaperMode : "none";
    const mainPanelTop =
        initialWallpaperMode === "banner"
            ? `${BANNER_HEIGHT_HOME}vh`
            : "5.5rem";
    const finalMainPanelTop =
        initialWallpaperMode === "banner" ? mainPanelTop : "5.5rem";
    return { initialWallpaperMode, mainPanelTop, finalMainPanelTop };
}

type RightSidebarState = {
    hasRightSidebarComponents: boolean;
    hasRightSidebarTocWidget: boolean;
};

function resolveRightSidebarState(): RightSidebarState {
    const rightTopComponents = widgetManager.getComponentsByPosition(
        "top",
        "right",
    );
    const rightStickyComponents = widgetManager.getComponentsByPosition(
        "sticky",
        "right",
    );
    const hasRightSidebarComponents =
        rightTopComponents.length > 0 || rightStickyComponents.length > 0;
    const hasRightSidebarTocWidget = [
        ...rightTopComponents,
        ...rightStickyComponents,
    ].some((component) => component.type === "toc");
    return { hasRightSidebarComponents, hasRightSidebarTocWidget };
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
  transition-fade overflow-clip w-full
  col-span-1 row-start-1 row-end-2
  ${desktopShowSidebar ? mainGridPositionClass : "col-span-1"}
`
        .trim()
        .replace(/\s+/g, " ");
}

export function buildMainGridLayoutState(
    siteConfig: SiteConfig,
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
    } = resolveTocState(siteConfig, pathname);

    const { isHomePage, isFullWidthPage, isPostEditorPage, showHomeText } =
        resolvePageKindState(siteConfig, pathname);

    const { initialWallpaperMode, mainPanelTop, finalMainPanelTop } =
        resolveWallpaperPanelState(siteConfig, isHomePage);

    const hasLeftSidebarComponents =
        widgetManager.getComponentsByPosition("top", "left").length > 0 ||
        widgetManager.getComponentsByPosition("sticky", "left").length > 0;

    const { hasRightSidebarComponents, hasRightSidebarTocWidget } =
        resolveRightSidebarState();

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
        ? "onload-animation mb-4 max-w-[17.5rem] col-start-1 col-end-2 row-start-1 row-end-2"
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
        Boolean(siteConfig.banner.carousel?.enable) &&
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
    };
}
