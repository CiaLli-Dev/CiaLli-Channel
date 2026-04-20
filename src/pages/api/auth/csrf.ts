import type { APIContext } from "astro";

import { ensureCsrfCookie } from "@/server/security/csrf";

function json<T>(data: T, init?: ResponseInit): Response {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...(init?.headers ?? {}),
        },
    });
}

export async function GET(context: APIContext): Promise<Response> {
    const token = ensureCsrfCookie(context);
    return json(
        {
            ok: true,
            token,
        },
        {
            headers: {
                "Cache-Control": "private, no-store",
            },
        },
    );
}
