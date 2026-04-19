import type { RSSFeedItem } from "@astrojs/rss";
import rss from "@astrojs/rss";
import type { APIContext } from "astro";

import { buildSiteFeed } from "@/server/application/feed/site-feed.service";
import { resolveCanonicalSiteUrl } from "@/server/http/request-url";
import type { ResolvedSiteSettings } from "@/types/site-settings";

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
    const site = resolveCanonicalSiteUrl({
        request: context.request,
        url: context.url,
        headers: context.request.headers,
    });
    const feed = await buildSiteFeed({
        site,
        resolvedSiteSettings: context.locals.siteSettings as
            | ResolvedSiteSettings
            | undefined,
    });
    const items: RSSFeedItem[] = feed.entries.map((entry) => ({
        title: entry.title,
        description: entry.summary,
        pubDate: entry.published,
        link: entry.link,
        content: entry.content,
    }));

    return rss({
        title: feed.title,
        description: feed.description,
        site,
        items,
        customData: `<language>${feed.language}</language>`,
    });
}
