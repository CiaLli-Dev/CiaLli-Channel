import { getSortedPosts } from "@/utils/content-utils";
import { getPostUrl } from "@/utils/url-utils";

export type SitemapEntry = {
    loc: string;
    lastmod?: string;
};

const STATIC_PUBLIC_PATHS = [
    "/",
    "/about",
    "/bulletin",
    "/friends",
    "/posts",
    "/rss",
    "/rss.xml",
    "/atom",
    "/atom.xml",
    "/stats",
] as const;

export async function buildPublicSitemapEntries(
    site: URL,
): Promise<SitemapEntry[]> {
    const entries = new Map<string, SitemapEntry>();

    for (const path of STATIC_PUBLIC_PATHS) {
        const loc = new URL(path, site).href;
        entries.set(loc, { loc });
    }

    const posts = (await getSortedPosts()).filter(
        (post) => !post.data.encrypted,
    );
    for (const post of posts) {
        const loc = new URL(post.url || getPostUrl(post), site).href;
        entries.set(loc, {
            loc,
            lastmod: (post.data.updated || post.data.published).toISOString(),
        });
    }

    return [...entries.values()];
}

export function renderSitemapUrlSet(entries: SitemapEntry[]): string {
    const items = entries
        .map((entry) => {
            const lastmod = entry.lastmod
                ? `<lastmod>${entry.lastmod}</lastmod>`
                : "";
            return `<url><loc>${entry.loc}</loc>${lastmod}</url>`;
        })
        .join("");

    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</urlset>`
    );
}

export function renderSitemapIndex(locations: URL[]): string {
    const items = locations
        .map((location) => `<sitemap><loc>${location.href}</loc></sitemap>`)
        .join("");

    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>`
    );
}
