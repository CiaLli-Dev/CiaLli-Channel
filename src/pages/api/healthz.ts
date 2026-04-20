import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = () => {
    return new Response(
        JSON.stringify({
            ok: true,
            status: "healthy",
            timestamp: new Date().toISOString(),
        }),
        {
            headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
            },
        },
    );
};
