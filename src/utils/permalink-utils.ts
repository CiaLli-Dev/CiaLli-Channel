import { permalinkConfig } from "@/config";
import { removeFileExtension } from "./url-utils";

// 文章 ID 映射缓存（用于存储按时间排序后的文章序号）
let postIdMap: Map<string, number> | null = null;

export type PermalinkPost = {
    id: string;
    data: {
        published?: Date;
        created?: Date;
        category?: string;
        alias?: string;
        permalink?: string;
    };
};

function safeCreatedDate(post: PermalinkPost): Date {
    const date =
        post.data.created instanceof Date ? post.data.created : new Date(0);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function safePermalinkDate(post: PermalinkPost): Date {
    const date =
        post.data.published instanceof Date
            ? post.data.published
            : safeCreatedDate(post);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/**
 * 初始化文章 ID 映射
 * 按创建时间升序排列（最早的文章 id = 1），草稿文章不参与计算
 * @param posts 所有非草稿文章
 */
export function initPostIdMap(posts: PermalinkPost[]): Map<string, number> {
    if (postIdMap) {
        return postIdMap;
    }

    // 按创建时间升序排序（最早的在前），避免编辑导致 %post_id% 漂移。
    const sortedPosts = [...posts].sort(
        (a, b) => safeCreatedDate(a).getTime() - safeCreatedDate(b).getTime(),
    );

    postIdMap = new Map();
    sortedPosts.forEach((post, index) => {
        // id 从 1 开始
        postIdMap!.set(post.id, index + 1);
    });

    return postIdMap;
}

/**
 * 获取文章的序号 ID
 * @param postId 文章的 content collection id
 * @returns 文章序号，如果未初始化则返回 0
 */
export function getPostNumericId(postId: string): number {
    if (!postIdMap) {
        // 在客户端或未初始化时返回 0，使用默认 slug
        console.warn("Post ID map not initialized. Returning 0 for post_id.");
        return 0;
    }
    return postIdMap.get(postId) ?? 0;
}

/**
 * 清除文章 ID 映射缓存（用于测试或重新初始化）
 */
export function clearPostIdMap(): void {
    postIdMap = null;
}

/**
 * 生成 permalink slug
 * 根据配置的格式模板和文章数据生成 URL slug
 * @param post 文章数据
 * @returns 生成的 slug（不包含 /posts/ 前缀）
 */
export function generatePermalinkSlug(post: PermalinkPost): string {
    // 如果文章有自定义 permalink，优先使用（不在 /posts/ 下）
    if (post.data.permalink) {
        // 移除开头和结尾的斜杠
        return post.data.permalink.replace(/^\/+/, "").replace(/\/+$/, "");
    }

    // 如果全局 permalink 功能未启用，使用默认 slug
    if (!permalinkConfig.enable) {
        // 如果有 alias，使用 alias
        if (post.data.alias) {
            return post.data.alias.replace(/^\/+/, "").replace(/\/+$/, "");
        }
        // 否则使用文件名
        return removeFileExtension(post.id);
    }

    // 使用全局 permalink 格式模板
    let format = permalinkConfig.format;

    // 验证格式不包含斜杠
    if (format.includes("/")) {
        console.warn(
            "Permalink format contains '/' which is not supported. Removing slashes.",
        );
        format = format.replace(/\//g, "-");
    }

    const published = safePermalinkDate(post);
    const postname = removeFileExtension(post.id);
    const category = post.data.category || "uncategorized";

    // 替换占位符
    return format
        .replace(/%year%/g, published.getFullYear().toString())
        .replace(
            /%monthnum%/g,
            (published.getMonth() + 1).toString().padStart(2, "0"),
        )
        .replace(/%day%/g, published.getDate().toString().padStart(2, "0"))
        .replace(/%hour%/g, published.getHours().toString().padStart(2, "0"))
        .replace(
            /%minute%/g,
            published.getMinutes().toString().padStart(2, "0"),
        )
        .replace(
            /%second%/g,
            published.getSeconds().toString().padStart(2, "0"),
        )
        .replace(/%post_id%/g, getPostNumericId(post.id).toString())
        .replace(/%postname%/g, postname)
        .replace(/%category%/g, category);
}

/**
 * 判断文章是否使用自定义 permalink（根目录下，不在 /posts/ 下）
 * @param post 文章数据
 */
export function hasCustomPermalink(
    post: PermalinkPost | { data: { permalink?: string } },
): boolean {
    return Boolean(post.data.permalink);
}

/**
 * 获取文章的完整 URL 路径
 * @param post 文章数据
 * @returns URL 路径（如 /my-post/ 或 /custom-path/）
 */
export function getPermalinkPath(post: PermalinkPost): string {
    const slug = generatePermalinkSlug(post);

    // 所有 permalink 生成的链接都在根目录下
    return `/${slug}`;
}
