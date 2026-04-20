import type { APIContext } from "astro";

import { buildSiteFeed } from "@/server/application/feed/site-feed.service";
import type { ResolvedSiteSettings } from "@/types/site-settings";

function escapeXml(raw: string): string {
    return raw
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

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

    let atomFeed = `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${escapeXml(feed.title)}</title>\n  <subtitle>${escapeXml(feed.description)}</subtitle>\n  <link href="${context.site}" rel="alternate" type="text/html"/>\n  <link href="${new URL("atom.xml", context.site)}" rel="self" type="application/atom+xml"/>\n  <id>${context.site}</id>\n  <updated>${feed.updated}</updated>\n  <language>${feed.language}</language>`;

    for (const entry of feed.entries) {
        const postUrl = new URL(entry.link, context.site).href;
        atomFeed += `\n  <entry>\n    <title>${escapeXml(entry.title)}</title>\n    <link href="${postUrl}" rel="alternate" type="text/html"/>\n    <id>${postUrl}</id>\n    <published>${entry.published.toISOString()}</published>\n    <updated>${entry.updated.toISOString()}</updated>\n    <summary>${escapeXml(entry.summary)}</summary>\n    <content type="html"><![CDATA[${entry.content}]]></content>\n    <author>\n      <name>${escapeXml(entry.authorName)}</name>\n    </author>`;

        if (entry.category) {
            atomFeed += `\n    <category term="${escapeXml(entry.category)}"></category>`;
        }

        atomFeed += "\n  </entry>";
    }

    atomFeed += "\n</feed>";

    return new Response(atomFeed, {
        headers: {
            "Content-Type": "application/atom+xml; charset=utf-8",
        },
    });
}
