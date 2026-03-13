import type { APIContext } from "astro";

import { renderMarkdown } from "@/server/markdown/render";
import { getResolvedSiteSettings } from "@/server/site-settings/service";
import { getSortedPosts } from "@/utils/content-utils";
import { getPostUrl } from "@/utils/url-utils";

export const prerender = false;

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
    const resolvedSiteSettings =
        context.locals.siteSettings ?? (await getResolvedSiteSettings());
    const settings = resolvedSiteSettings.settings;
    const system = resolvedSiteSettings.system;

    const posts = (await getSortedPosts()).filter(
        (post) => !post.data.encrypted,
    );

    let atomFeed = `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${escapeXml(settings.site.title)}</title>\n  <subtitle>${escapeXml(settings.site.subtitle || "No description")}</subtitle>\n  <link href="${context.site}" rel="alternate" type="text/html"/>\n  <link href="${new URL("atom.xml", context.site)}" rel="self" type="application/atom+xml"/>\n  <id>${context.site}</id>\n  <updated>${new Date().toISOString()}</updated>\n  <language>${system.lang}</language>`;

    for (const post of posts) {
        const postUrl = new URL(getPostUrl(post), context.site).href;
        const content = await renderMarkdown(String(post.body || ""), {
            target: "feed",
            site: context.site as URL,
        });
        atomFeed += `\n  <entry>\n    <title>${escapeXml(post.data.title)}</title>\n    <link href="${postUrl}" rel="alternate" type="text/html"/>\n    <id>${postUrl}</id>\n    <published>${post.data.published.toISOString()}</published>\n    <updated>${(post.data.updated || post.data.published).toISOString()}</updated>\n    <summary>${escapeXml(post.data.description || "")}</summary>\n    <content type="html"><![CDATA[${content}]]></content>\n    <author>\n      <name>${escapeXml(settings.profile.name)}</name>\n    </author>`;

        if (post.data.category) {
            atomFeed += `\n    <category term="${escapeXml(post.data.category)}"></category>`;
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
