import type { RSSFeedItem } from "@astrojs/rss";
import rss from "@astrojs/rss";
import type { APIContext } from "astro";

import { buildSiteFeed } from "@/server/application/feed/site-feed.service";
import type { ResolvedSiteSettings } from "@/types/site-settings";

export async function GET(context: APIContext): Promise<Response> {
    if (!context.site) {
        throw new Error("site not set");
    }
    const feed = await buildSiteFeed({
        site: context.site,
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
        site: context.site,
        items,
        customData: `<language>${feed.language}</language>`,
    });
}
