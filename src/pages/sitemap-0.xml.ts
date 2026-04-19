import type { APIRoute } from "astro";

import { resolveCanonicalSiteUrl } from "@/server/http/request-url";
import {
    buildPublicSitemapEntries,
    renderSitemapUrlSet,
} from "@/server/seo/sitemap";

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
    const site = resolveCanonicalSiteUrl({
        request,
        url,
        headers: request.headers,
    });
    const entries = await buildPublicSitemapEntries(site);
    const body = renderSitemapUrlSet(entries);

    return new Response(body, {
        headers: {
            "content-type": "application/xml; charset=utf-8",
        },
    });
};
