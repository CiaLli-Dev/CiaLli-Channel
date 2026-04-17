import { renderMarkdown } from "@/server/markdown/render";
import { getResolvedSiteSettings } from "@/server/site-settings/service";
import type { ResolvedSiteSettings } from "@/types/site-settings";
import type { DirectusPostEntry } from "@/utils/content-utils";
import { getSortedPosts } from "@/utils/content-utils";
import { getPostUrl } from "@/utils/url-utils";

export type SiteFeedEntry = {
    title: string;
    summary: string;
    link: string;
    content: string;
    published: Date;
    updated: Date;
    authorName: string;
    category: string | null;
};

export type SiteFeedBuildResult = {
    title: string;
    description: string;
    language: string;
    updated: string;
    entries: SiteFeedEntry[];
};

export type BuildSiteFeedOptions = {
    site: URL;
    resolvedSiteSettings?: ResolvedSiteSettings;
};

function isFeedVisiblePost(post: DirectusPostEntry): boolean {
    return post.data.encrypted !== true;
}

async function renderFeedEntry(
    post: DirectusPostEntry,
    site: URL,
): Promise<SiteFeedEntry> {
    return {
        title: post.data.title,
        summary: post.data.description || "",
        link: getPostUrl(post),
        content: await renderMarkdown(String(post.body || ""), {
            target: "feed",
            site,
        }),
        published: post.data.published,
        updated: post.data.updated || post.data.published,
        authorName: post.data.author.name,
        category: post.data.category ? String(post.data.category).trim() : null,
    };
}

export async function buildSiteFeed(
    options: BuildSiteFeedOptions,
): Promise<SiteFeedBuildResult> {
    const resolvedSiteSettings =
        options.resolvedSiteSettings ?? (await getResolvedSiteSettings());
    const settings = resolvedSiteSettings.settings;
    const system = resolvedSiteSettings.system;
    const posts = (await getSortedPosts()).filter(isFeedVisiblePost);

    // Promise.all 会保持输入顺序，既并发渲染 Markdown，也不改变 feed 排序。
    const entries = await Promise.all(
        posts.map(async (post) => await renderFeedEntry(post, options.site)),
    );

    return {
        title: settings.site.title,
        description: settings.site.subtitle || "No description",
        language: system.lang,
        updated: new Date().toISOString(),
        entries,
    };
}
