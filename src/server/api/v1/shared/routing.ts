import type { APIContext } from "astro";

import { fail } from "@/server/api/response";

export function isWriteMethod(method: string): boolean {
    return (
        method === "POST" ||
        method === "PUT" ||
        method === "PATCH" ||
        method === "DELETE"
    );
}

function readForwardedOrigin(headers: Headers): string {
    const forwardedHost = headers.get("x-forwarded-host")?.trim() || "";
    if (!forwardedHost) {
        return "";
    }

    const forwardedProto = headers.get("x-forwarded-proto")?.trim() || "http";
    const host = forwardedHost.split(",")[0]?.trim() || "";
    const proto = forwardedProto.split(",")[0]?.trim() || "http";
    if (!host) {
        return "";
    }

    try {
        return new URL(`${proto}://${host}`).origin;
    } catch {
        return "";
    }
}

function resolveAllowedOrigins(context: APIContext): string[] {
    const origins = new Set<string>([context.url.origin]);
    const forwardedOrigin = readForwardedOrigin(context.request.headers);

    // 反向代理场景下，Astro 看到的 context.url 可能是容器内地址；
    // 同时接受代理透传的外部 origin，避免 same-origin 守卫误杀正常浏览器请求。
    if (forwardedOrigin) {
        origins.add(forwardedOrigin);
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

export function parseSegments(context: APIContext): string[] {
    const raw = context.params.segments;
    if (!raw) {
        return [];
    }
    return raw
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
}
