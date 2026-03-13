import type {
    AppArticleComment,
    AppDiaryComment,
    CommentStatus,
} from "@/types/app";
import type { getAppAccessContext } from "@/server/auth/acl";

import type { ADMIN_MODULE_COLLECTION } from "./constants";
import type { AuthorBundleItem } from "./author-cache";

export type AdminModuleKey = keyof typeof ADMIN_MODULE_COLLECTION;

export type AppAccess = Awaited<ReturnType<typeof getAppAccessContext>>;

export type CommentRecord = AppArticleComment | AppDiaryComment;

export type CommentTreeNode = {
    id: string;
    parent_id: string | null;
    body: string;
    body_html: string;
    status: CommentStatus;
    is_public: boolean;
    show_on_profile: boolean;
    date_created: string | null;
    author_id: string;
    author: AuthorBundleItem;
    like_count: number;
    liked_by_viewer: boolean;
    replies: CommentTreeNode[];
};
