import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { permalinkConfig } from "@/config";
import { generatePermalinkSlug, type PermalinkPost } from "./permalink-utils";

/**
 * 移除文件扩展名（.md, .mdx, .markdown）
 * 用于将 Astro v5 Content Layer API 的 id 转换为 URL 友好的 slug
 */
export function removeFileExtension(id: string): string {
    return id.replace(/\.(md|mdx|markdown)$/i, "");
}

export function pathsEqual(path1: string, path2: string): boolean {
    const normalizedPath1 = path1.replace(/^\/|\/$/g, "").toLowerCase();
    const normalizedPath2 = path2.replace(/^\/|\/$/g, "").toLowerCase();
    return normalizedPath1 === normalizedPath2;
}

function joinUrl(...parts: string[]): string {
    const joined = parts.join("/");
    return joined.replace(/\/+/g, "/");
}

export function getPostUrlBySlug(slug: string): string {
    // 移除文件扩展名（如 .md, .mdx 等）
    const slugWithoutExt = removeFileExtension(slug);
    return url(`/posts/${slugWithoutExt}`);
}

export function getPostUrlByAlias(alias: string): string {
    // 移除开头的斜杠并确保固定链接在 /posts/ 路径下
    const cleanAlias = alias.replace(/^\/+/, "");
    return url(`/posts/${cleanAlias}`);
}

type PostUrlInput =
    | (PermalinkPost & { slug?: string | null; url?: string })
    | {
          id?: string;
          slug?: string | null;
          url?: string;
          data?: { alias?: string; permalink?: string };
      };

function normalizePostSlug(post: PostUrlInput): string {
    const explicitSlug = "slug" in post ? post.slug : undefined;
    const candidate = explicitSlug || ("id" in post ? post.id : "");
    return removeFileExtension(String(candidate || ""));
}

export function getPostUrl(post: PostUrlInput): string {
    if ("url" in post && typeof post.url === "string" && post.url.trim()) {
        return url(post.url.trim());
    }

    const data =
        "data" in post && post.data && typeof post.data === "object"
            ? post.data
            : {};

    // 如果文章有自定义 permalink，优先使用（在根目录下）
    if (data.permalink) {
        const slug = data.permalink.replace(/^\/+/, "").replace(/\/+$/, "");
        return url(`/${slug}`);
    }

    // 如果全局 permalink 功能启用，使用生成的 slug（在根目录下）
    if (
        permalinkConfig.enable &&
        "id" in post &&
        "data" in post &&
        post.data &&
        typeof post.data === "object"
    ) {
        const slug = generatePermalinkSlug(post as PermalinkPost);
        return url(`/${slug}`);
    }

    // 如果文章有 alias，使用 alias（在 /posts/ 下）
    if (data.alias) {
        return getPostUrlByAlias(data.alias);
    }

    // 否则使用默认的 slug 路径
    return getPostUrlBySlug(normalizePostSlug(post));
}

export function getTagUrl(tag: string): string {
    if (!tag) {
        return url("/posts");
    }
    return url(`/posts?tag=${encodeURIComponent(tag.trim())}`);
}

export function getCategoryUrl(category: string | null): string {
    if (
        !category ||
        category.trim() === "" ||
        category.trim().toLowerCase() ===
            i18n(I18nKey.contentUncategorized).toLowerCase()
    ) {
        return url("/posts?uncategorized=true");
    }
    return url(`/posts?category=${encodeURIComponent(category.trim())}`);
}

export function getDir(path: string): string {
    // 移除文件扩展名
    const pathWithoutExt = removeFileExtension(path);
    const lastSlashIndex = pathWithoutExt.lastIndexOf("/");
    if (lastSlashIndex < 0) {
        return "/";
    }
    return pathWithoutExt.substring(0, lastSlashIndex + 1);
}

export function getFileDirFromPath(filePath: string): string {
    return filePath.replace(/^src\//, "").replace(/\/[^/]+$/, "");
}

export function url(path: string): string {
    return joinUrl("", import.meta.env.BASE_URL, path);
}
