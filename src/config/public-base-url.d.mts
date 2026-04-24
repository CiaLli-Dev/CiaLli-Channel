export type ResolvedPublicBaseUrl = {
    origin: string;
    siteURL: string;
    hostname: string;
    host: string;
    protocol: "http:" | "https:";
    port: string;
};

export function resolvePublicBaseUrl(
    env: Record<string, unknown>,
    options?: {
        envName?: string;
        fallbackKeys?: string[];
    },
): ResolvedPublicBaseUrl;
