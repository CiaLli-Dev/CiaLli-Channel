export type SamePageNavigationCheckOptions = {
    currentUrl: URL;
    targetUrl: URL;
    targetAttr: string | null;
    hasDownload: boolean;
};

export function normalizeNavigationPathname(pathname: string): string {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized === "" ? "/" : normalized;
}

export function isSelfBrowsingTarget(targetAttr: string | null): boolean {
    const normalized = String(targetAttr || "")
        .trim()
        .toLowerCase();
    return normalized === "" || normalized === "_self";
}

function isHttpProtocol(protocol: string): boolean {
    return protocol === "http:" || protocol === "https:";
}

export function shouldIgnoreSamePageNavigation(
    options: SamePageNavigationCheckOptions,
): boolean {
    if (options.hasDownload) {
        return false;
    }
    if (!isSelfBrowsingTarget(options.targetAttr)) {
        return false;
    }
    if (!isHttpProtocol(options.targetUrl.protocol)) {
        return false;
    }
    if (options.targetUrl.origin !== options.currentUrl.origin) {
        return false;
    }

    return (
        normalizeNavigationPathname(options.targetUrl.pathname) ===
            normalizeNavigationPathname(options.currentUrl.pathname) &&
        options.targetUrl.search === options.currentUrl.search &&
        options.targetUrl.hash === options.currentUrl.hash
    );
}
