import type { APIContext } from "astro";

import { fail } from "@/server/api/response";

function readFirstHeaderValue(value: string | null): string {
    return value?.split(",")[0]?.trim() || "";
}

function buildOriginFromParts(proto: string, host: string): string {
    if (!host) {
        return "";
    }

    try {
        return new URL(`${proto}://${host}`).origin;
    } catch {
        return "";
    }
}

function readForwardedHeaderOrigin(headers: Headers): string {
    const forwarded = readFirstHeaderValue(headers.get("forwarded"));
    if (!forwarded) {
        return "";
    }

    const parts = forwarded.split(";");
    let host = "";
    let proto = "";

    for (const part of parts) {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex < 0) {
            continue;
        }

        const key = part.slice(0, separatorIndex).trim().toLowerCase();
        const rawValue = part.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^"|"$/g, "");

        if (key === "host") {
            host = value;
        } else if (key === "proto") {
            proto = value;
        }
    }

    return buildOriginFromParts(proto || "http", host);
}

function readProxyOrigins(headers: Headers): string[] {
    const origins = new Set<string>();
    const forwardedProto = readFirstHeaderValue(
        headers.get("x-forwarded-proto"),
    );
    const forwardedHost = readFirstHeaderValue(headers.get("x-forwarded-host"));
    const host = readFirstHeaderValue(headers.get("host"));

    const forwardedOrigin = buildOriginFromParts(
        forwardedProto || "http",
        forwardedHost,
    );
    if (forwardedOrigin) {
        origins.add(forwardedOrigin);
    }

    const forwardedHeaderOrigin = readForwardedHeaderOrigin(headers);
    if (forwardedHeaderOrigin) {
        origins.add(forwardedHeaderOrigin);
    }

    // 某些反向代理只保留原始 Host，并通过 X-Forwarded-Proto 标识外部协议。
    if (host && forwardedProto) {
        const hostOrigin = buildOriginFromParts(forwardedProto, host);
        if (hostOrigin) {
            origins.add(hostOrigin);
        }
    }

    return [...origins];
}

function resolveAllowedOrigins(context: APIContext): string[] {
    const origins = new Set<string>([context.url.origin]);

    // 反向代理场景下，Astro 看到的 context.url 可能是容器内地址；
    // 同时接受代理透传的外部 origin，避免 same-origin 守卫误杀正常浏览器请求。
    for (const origin of readProxyOrigins(context.request.headers)) {
        origins.add(origin);
    }

    return [...origins];
}

export function assertSameOrigin(context: APIContext): Response | null {
    const origin = context.request.headers.get("origin");
    if (!origin) {
        return fail("缺少 Origin 头", 403);
    }

    const allowedOrigins = resolveAllowedOrigins(context);
    if (!allowedOrigins.includes(origin)) {
        return fail("非法来源请求", 403);
    }

    return null;
}
