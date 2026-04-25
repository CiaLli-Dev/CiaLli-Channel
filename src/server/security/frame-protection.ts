const HTML_CONTENT_TYPE_RE = /^\s*text\/html(?:\s*(?:;|$))/i;
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CLIENT_FETCH_MODES = new Set(["cors", "same-origin"]);
const DOCUMENT_FETCH_DESTINATIONS = new Set(["document", "iframe", "frame"]);
const SAME_ORIGIN_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);
const SAME_ORIGIN_FRAME_DESTINATIONS = new Set(["iframe", "frame"]);

export const FRAME_ANCESTORS_POLICY = "frame-ancestors 'none'";
export const FRAME_ANCESTORS_SELF_POLICY = "frame-ancestors 'self'";
export const X_FRAME_OPTIONS_DENY = "DENY";
export const X_FRAME_OPTIONS_SAMEORIGIN = "SAMEORIGIN";

export type FrameProtectionPolicy = "deny" | "same-origin-frame" | "skip";

export type FrameProtectionRequestContext = {
    url: URL;
    request?: Pick<Request, "headers" | "method">;
    allowSameOriginFrameNavigation?: boolean;
};

export function isHtmlResponse(response: Response): boolean {
    const contentType = response.headers.get("content-type");
    if (!contentType) {
        return false;
    }

    return HTML_CONTENT_TYPE_RE.test(contentType);
}

export function mergeFrameAncestorsDirective(
    contentSecurityPolicy: string | null,
    frameAncestorsPolicy = FRAME_ANCESTORS_POLICY,
): string {
    const directives = String(contentSecurityPolicy || "")
        .split(";")
        .map((directive) => directive.trim())
        .filter(Boolean);

    if (directives.length === 0) {
        return frameAncestorsPolicy;
    }

    let replaced = false;
    const nextDirectives = directives.map((directive) => {
        if (!/^frame-ancestors\b/i.test(directive)) {
            return directive;
        }

        replaced = true;
        return frameAncestorsPolicy;
    });

    if (!replaced) {
        nextDirectives.push(frameAncestorsPolicy);
    }

    return nextDirectives.join("; ");
}

function normalizeHeaderValue(value: string | null): string {
    return value?.trim().toLowerCase() ?? "";
}

function isLoopbackUrl(url: URL): boolean {
    return LOOPBACK_HOSTNAMES.has(url.hostname);
}

function hasSameOriginReferer(url: URL, headers: Headers): boolean {
    const referer = headers.get("referer");
    if (!referer) {
        return false;
    }

    try {
        return new URL(referer).origin === url.origin;
    } catch {
        return false;
    }
}

function hasSameOriginRequestSignal(url: URL, headers: Headers): boolean {
    const fetchSite = normalizeHeaderValue(headers.get("sec-fetch-site"));
    if (SAME_ORIGIN_FETCH_SITES.has(fetchSite)) {
        return true;
    }

    if (fetchSite.length > 0) {
        return false;
    }

    return hasSameOriginReferer(url, headers);
}

function hasSafeHtmlRequestMethod(request: Pick<Request, "method">): boolean {
    const method = request.method.toUpperCase();
    return method === "GET" || method === "HEAD";
}

function hasUpgradeInsecureRequests(headers: Headers): boolean {
    return (
        normalizeHeaderValue(headers.get("upgrade-insecure-requests")) === "1"
    );
}

function hasExplicitDocumentNavigation(headers: Headers): boolean {
    const fetchDest = normalizeHeaderValue(headers.get("sec-fetch-dest"));
    const fetchMode = normalizeHeaderValue(headers.get("sec-fetch-mode"));

    return (
        DOCUMENT_FETCH_DESTINATIONS.has(fetchDest) || fetchMode === "navigate"
    );
}

export function isSameOriginFrameNavigation(
    context: FrameProtectionRequestContext,
): boolean {
    const request = context.request;
    if (!context.allowSameOriginFrameNavigation || !request) {
        return false;
    }

    if (!hasSafeHtmlRequestMethod(request)) {
        return false;
    }

    const headers = request.headers;
    const fetchDest = normalizeHeaderValue(headers.get("sec-fetch-dest"));
    const fetchMode = normalizeHeaderValue(headers.get("sec-fetch-mode"));

    return (
        SAME_ORIGIN_FRAME_DESTINATIONS.has(fetchDest) &&
        fetchMode === "navigate" &&
        hasSameOriginReferer(context.url, headers) &&
        hasSameOriginRequestSignal(context.url, headers)
    );
}

export function isSameOriginClientHtmlFetch(
    context: FrameProtectionRequestContext,
): boolean {
    const request = context.request;
    if (!request) {
        return false;
    }

    if (!hasSafeHtmlRequestMethod(request)) {
        return false;
    }

    const headers = request.headers;
    if (
        hasUpgradeInsecureRequests(headers) ||
        hasExplicitDocumentNavigation(headers)
    ) {
        return false;
    }

    const fetchDest = normalizeHeaderValue(headers.get("sec-fetch-dest"));
    const fetchMode = normalizeHeaderValue(headers.get("sec-fetch-mode"));
    if (fetchDest === "empty" || CLIENT_FETCH_MODES.has(fetchMode)) {
        return hasSameOriginRequestSignal(context.url, headers);
    }

    const fetchSite = normalizeHeaderValue(headers.get("sec-fetch-site"));
    const hasFetchMetadata =
        fetchDest.length > 0 || fetchMode.length > 0 || fetchSite.length > 0;
    return !hasFetchMetadata && hasSameOriginReferer(context.url, headers);
}

export function resolveFrameProtectionPolicy(
    context?: FrameProtectionRequestContext,
): FrameProtectionPolicy {
    if (!context) {
        return "deny";
    }

    if (isLoopbackUrl(context.url) || isSameOriginClientHtmlFetch(context)) {
        return "skip";
    }

    if (isSameOriginFrameNavigation(context)) {
        return "same-origin-frame";
    }

    return "deny";
}

export function shouldApplyFrameProtection(
    context: FrameProtectionRequestContext,
): boolean {
    return resolveFrameProtectionPolicy(context) !== "skip";
}

export function applyFrameProtectionHeaders(
    response: Response,
    context?: FrameProtectionRequestContext,
): void {
    if (!isHtmlResponse(response)) {
        return;
    }

    const policy = resolveFrameProtectionPolicy(context);
    if (policy === "skip") {
        return;
    }

    if (policy === "same-origin-frame") {
        response.headers.set("X-Frame-Options", X_FRAME_OPTIONS_SAMEORIGIN);
        response.headers.set(
            "Content-Security-Policy",
            mergeFrameAncestorsDirective(
                response.headers.get("Content-Security-Policy"),
                FRAME_ANCESTORS_SELF_POLICY,
            ),
        );
        return;
    }

    response.headers.set("X-Frame-Options", X_FRAME_OPTIONS_DENY);
    response.headers.set(
        "Content-Security-Policy",
        mergeFrameAncestorsDirective(
            response.headers.get("Content-Security-Policy"),
        ),
    );
}
