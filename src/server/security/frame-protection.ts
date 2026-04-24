const HTML_CONTENT_TYPE_RE = /^\s*text\/html(?:\s*(?:;|$))/i;

export const FRAME_ANCESTORS_POLICY = "frame-ancestors 'none'";
export const X_FRAME_OPTIONS_DENY = "DENY";

export function isHtmlResponse(response: Response): boolean {
    const contentType = response.headers.get("content-type");
    if (!contentType) {
        return false;
    }

    return HTML_CONTENT_TYPE_RE.test(contentType);
}

export function mergeFrameAncestorsDirective(
    contentSecurityPolicy: string | null,
): string {
    const directives = String(contentSecurityPolicy || "")
        .split(";")
        .map((directive) => directive.trim())
        .filter(Boolean);

    if (directives.length === 0) {
        return FRAME_ANCESTORS_POLICY;
    }

    let replaced = false;
    const nextDirectives = directives.map((directive) => {
        if (!/^frame-ancestors\b/i.test(directive)) {
            return directive;
        }

        replaced = true;
        return FRAME_ANCESTORS_POLICY;
    });

    if (!replaced) {
        nextDirectives.push(FRAME_ANCESTORS_POLICY);
    }

    return nextDirectives.join("; ");
}

export function applyFrameProtectionHeaders(response: Response): void {
    if (!isHtmlResponse(response)) {
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
