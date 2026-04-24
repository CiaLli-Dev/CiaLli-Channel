import { isIP } from "node:net";

type AiBaseUrlValidationOptions = {
    allowLocalhost: boolean;
};

function isLoopbackHostname(hostname: string): boolean {
    return hostname === "localhost" || hostname.endsWith(".local");
}

function isPrivateIpv4Address(hostname: string): boolean {
    const parts = hostname.split(".").map((segment) => Number(segment));
    if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value))) {
        return false;
    }

    const [first, second] = parts;
    return (
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
    );
}

function isForbiddenIpv6Address(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return (
        normalized === "::1" ||
        normalized.startsWith("fe80:") ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd")
    );
}

function isLocalTarget(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    if (isLoopbackHostname(normalized)) {
        return true;
    }

    const ipVersion = isIP(normalized);
    if (ipVersion === 4) {
        return isPrivateIpv4Address(normalized);
    }
    if (ipVersion === 6) {
        return isForbiddenIpv6Address(normalized);
    }

    return false;
}

export function isAiBaseUrlLocalAllowedEnvironment(): boolean {
    const nodeEnv = String(process.env.NODE_ENV || "")
        .trim()
        .toLowerCase();
    if (nodeEnv && nodeEnv !== "production") {
        return true;
    }

    const publicBaseUrl = String(
        process.env.APP_PUBLIC_BASE_URL ||
            import.meta.env.APP_PUBLIC_BASE_URL ||
            "",
    ).trim();
    if (!publicBaseUrl) {
        return nodeEnv !== "production";
    }

    try {
        return isLocalTarget(new URL(publicBaseUrl).hostname);
    } catch {
        return nodeEnv !== "production";
    }
}

export function validateAiBaseUrl(
    baseUrl: string,
    options: AiBaseUrlValidationOptions,
): string {
    const normalized = String(baseUrl || "").trim();
    if (!normalized) {
        return "";
    }

    let parsed: URL;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error("AI API Base URL 非法");
    }

    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const isLocalTargetHost = isLocalTarget(hostname);

    if (
        protocol !== "https:" &&
        !(options.allowLocalhost && protocol === "http:")
    ) {
        throw new Error("AI API Base URL 仅支持 HTTPS；本地环境可使用 HTTP");
    }

    if (!options.allowLocalhost && isLocalTargetHost) {
        throw new Error(
            "生产环境的 AI API Base URL 不允许使用 localhost 或内网地址",
        );
    }

    return normalized.replace(/\/+$/u, "");
}

export function validateAiBaseUrlForCurrentEnvironment(
    baseUrl: string,
): string {
    return validateAiBaseUrl(baseUrl, {
        allowLocalhost: isAiBaseUrlLocalAllowedEnvironment(),
    });
}
