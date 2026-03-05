/**
 * Article 领域特有类型
 */

import type { AppArticle, AppStatus } from "@/types/app";

/** 创建文章所需的输入 */
export interface CreateArticleInput {
    title: string;
    slug?: string | null;
    summary?: string | null;
    body_markdown: string;
    cover_file?: string | null;
    cover_url?: string | null;
    tags?: string[];
    category?: string | null;
    status?: AppStatus;
    allow_comments?: boolean;
    is_public?: boolean;
}

/** 更新文章所需的输入（所有字段可选） */
export type UpdateArticleInput = Partial<CreateArticleInput>;

/** 文章可见性上下文 */
export interface ArticleVisibilityContext {
    article: Pick<AppArticle, "status" | "is_public" | "allow_comments">;
    viewerId: string | null;
    authorId: string;
    isAdmin: boolean;
}
