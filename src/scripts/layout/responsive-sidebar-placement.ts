type ResponsiveSidebarMount = {
    nodeSelector: string;
    desktopAnchorSelector: string;
    mobileAnchorSelector: string;
};

const MOBILE_MEDIA_QUERY = "(max-width: 1279px)";

const RESPONSIVE_SIDEBAR_MOUNTS: ResponsiveSidebarMount[] = [
    {
        nodeSelector: "[data-responsive-sidebar-node]",
        desktopAnchorSelector: "[data-responsive-sidebar-desktop-anchor]",
        mobileAnchorSelector: "[data-responsive-sidebar-mobile-anchor]",
    },
    {
        nodeSelector: "[data-responsive-right-sidebar-node]",
        desktopAnchorSelector: "[data-responsive-right-sidebar-desktop-anchor]",
        mobileAnchorSelector: "[data-responsive-right-sidebar-mobile-anchor]",
    },
];

function relocateResponsiveSidebarMount(mount: ResponsiveSidebarMount): void {
    const sidebarNode = document.querySelector<HTMLElement>(mount.nodeSelector);
    const desktopAnchor = document.querySelector<HTMLElement>(
        mount.desktopAnchorSelector,
    );
    const mobileAnchor = document.querySelector<HTMLElement>(
        mount.mobileAnchorSelector,
    );

    if (
        !(sidebarNode instanceof HTMLElement) ||
        !(desktopAnchor instanceof HTMLElement)
    ) {
        return;
    }

    const shouldUseMobileAnchor =
        window.matchMedia(MOBILE_MEDIA_QUERY).matches &&
        mobileAnchor instanceof HTMLElement;
    const target = shouldUseMobileAnchor ? mobileAnchor : desktopAnchor;

    if (sidebarNode.parentElement !== target) {
        target.appendChild(sidebarNode);
    }
}

function relocateResponsiveSidebar(): void {
    RESPONSIVE_SIDEBAR_MOUNTS.forEach((mount) => {
        relocateResponsiveSidebarMount(mount);
    });
}

function bootstrapResponsiveSidebarPlacement(): void {
    if (
        document.documentElement.dataset.responsiveSidebarPlacementBound === "1"
    ) {
        relocateResponsiveSidebar();
        return;
    }

    document.documentElement.dataset.responsiveSidebarPlacementBound = "1";
    const scheduleRelocation = (): void => {
        window.requestAnimationFrame(() => {
            relocateResponsiveSidebar();
        });
    };

    window.addEventListener("resize", scheduleRelocation, { passive: true });
    document.addEventListener("astro:after-swap", scheduleRelocation);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", scheduleRelocation, {
            once: true,
        });
        return;
    }

    scheduleRelocation();
}

if (typeof window !== "undefined") {
    bootstrapResponsiveSidebarPlacement();
}
