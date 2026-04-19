import {
    readBooleanRuntimeEnv,
    readOptionalRuntimeEnv,
} from "@/server/env/runtime";

type RequestUrlInput = {
    headers?: Headers;
    url?: URL;
    request?: Request;
};

function readTrustedForwardedHeader(
    headers: Headers | undefined,
    headerName: string,
): string {
    if (!headers || !readBooleanRuntimeEnv("APP_TRUST_PROXY")) {
        return "";
    }

    const rawValue = headers.get(headerName) || "";
    if (!rawValue.trim()) {
        return "";
    }

    return rawValue.split(",")[0]?.trim().replace(/\/+$/u, "") || "";
}

function resolveFallbackUrl(input: RequestUrlInput): URL | null {
    if (input.url instanceof URL) {
        return input.url;
    }

    if (input.request instanceof Request) {
        try {
            return new URL(input.request.url);
        } catch {
            return null;
        }
    }

    return null;
}

function resolveProtocol(input: RequestUrlInput): string {
    const forwardedProtocol = readTrustedForwardedHeader(
        input.headers,
        "x-forwarded-proto",
    );
    if (forwardedProtocol === "http" || forwardedProtocol === "https") {
        return `${forwardedProtocol}:`;
    }

    return resolveFallbackUrl(input)?.protocol || "http:";
}

function resolveHost(input: RequestUrlInput): string {
    const forwardedHost = readTrustedForwardedHeader(
        input.headers,
        "x-forwarded-host",
    );
    if (forwardedHost) {
        return forwardedHost;
    }

    const hostHeader = input.headers?.get("host")?.trim();
    if (hostHeader) {
        return hostHeader;
    }

    return resolveFallbackUrl(input)?.host || "localhost";
}

export function resolveRequestOrigin(input: RequestUrlInput): string {
    return `${resolveProtocol(input)}//${resolveHost(input)}`;
}

export function isSecureRequest(input: RequestUrlInput): boolean {
    return resolveProtocol(input) === "https:";
}

export function getConfiguredSiteUrl(): URL | null {
    const rawValue = readOptionalRuntimeEnv("APP_SITE_URL");
    if (!rawValue) {
        return null;
    }

    try {
        const parsed = new URL(rawValue);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * 站点对外 canonical URL 优先使用显式 APP_SITE_URL。
 * 若未配置，则按当前请求 URL（可选信任反向代理头）动态推导，
 * 以兼容同一镜像在不同演示机器上的复用场景。
 */
export function resolveCanonicalSiteUrl(input: RequestUrlInput): URL {
    const configured = getConfiguredSiteUrl();
    if (configured) {
        return configured;
    }

    return new URL(resolveRequestOrigin(input));
}
