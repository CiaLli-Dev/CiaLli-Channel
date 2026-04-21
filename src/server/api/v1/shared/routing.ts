import type { APIContext } from "astro";

import { assertSameOrigin } from "@/server/security/origin";

export { assertSameOrigin };

export function isWriteMethod(method: string): boolean {
    return (
        method === "POST" ||
        method === "PUT" ||
        method === "PATCH" ||
        method === "DELETE"
    );
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
