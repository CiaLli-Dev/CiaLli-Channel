const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://cdn.jsdelivr.net https://unpkg.com https://code.iconify.design https://vercel.live",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https:",
    "media-src 'self' https: http: blob:",
    "frame-src 'self' https://www.googletagmanager.com https://www.youtube.com https://player.bilibili.com https://www.notion.so https://notion.so https://*.notion.site",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
].join("; ");

function isSecureRequest(params: { url?: URL; headers?: Headers }): boolean {
    if (params.url?.protocol === "https:") {
        return true;
    }

    // 兼容反向代理场景：X-Forwarded-Proto 可能携带逗号分隔的链路值，取首个即可。
    const forwardedProto = params.headers
        ?.get("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim()
        .toLowerCase();
    return forwardedProto === "https";
}

export function applyCommonSecurityHeaders(params: {
    response: Response;
    url?: URL;
    headers?: Headers;
}): Response {
    const { response, url, headers } = params;
    const headerPairs = [
        ["X-Content-Type-Options", "nosniff"],
        ["X-Frame-Options", "DENY"],
        ["Referrer-Policy", "strict-origin-when-cross-origin"],
        ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
    ] as const;

    for (const [name, value] of headerPairs) {
        if (!response.headers.has(name)) {
            response.headers.set(name, value);
        }
    }

    if (
        !response.headers.has("Strict-Transport-Security") &&
        isSecureRequest({ url, headers })
    ) {
        response.headers.set(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        );
    }

    return response;
}
