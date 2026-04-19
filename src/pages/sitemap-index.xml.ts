import type { APIRoute } from "astro";

import { resolveCanonicalSiteUrl } from "@/server/http/request-url";
import { renderSitemapIndex } from "@/server/seo/sitemap";

export const prerender = false;

export const GET: APIRoute = ({ request, url }) => {
    const site = resolveCanonicalSiteUrl({
        request,
        url,
        headers: request.headers,
    });
    const body = renderSitemapIndex([new URL("sitemap-0.xml", site)]);

    return new Response(body, {
        headers: {
            "content-type": "application/xml; charset=utf-8",
        },
    });
};
