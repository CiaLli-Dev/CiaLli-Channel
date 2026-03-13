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

export function assertSameOrigin(context: APIContext): Response | null {
    const origin = context.request.headers.get("origin");
    if (!origin) {
        return fail("缺少 Origin 头", 403);
    }
    if (origin !== context.url.origin) {
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
