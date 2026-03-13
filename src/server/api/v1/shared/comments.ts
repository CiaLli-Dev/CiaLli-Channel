import type { AuthorBundleItem } from "./author-cache";
import type { CommentRecord, CommentTreeNode } from "./types";

const COMMENT_BODY_BASE64_PREFIX = "__DC_UTF8_B64__:";

function createFallbackAuthor(userId: string): AuthorBundleItem {
    const normalizedId = String(userId || "").trim();
    const suffix = (normalizedId || "unknown").slice(0, 8);
    return {
        id: normalizedId,
        name: `user-${suffix}`,
        username: `user-${suffix}`,
    };
}

function decodeLegacyCommentBody(input: string | null | undefined): string {
    const text = String(input || "");
    if (!text.startsWith(COMMENT_BODY_BASE64_PREFIX)) {
        return text;
    }

    const encoded = text.slice(COMMENT_BODY_BASE64_PREFIX.length);
    if (!encoded) {
        return "";
    }

    try {
        return Buffer.from(encoded, "base64").toString("utf8");
    } catch (error) {
        console.warn("[api/v1] failed to decode legacy comment body:", error);
        return text;
    }
}

export function buildCommentTree(
    comments: CommentRecord[],
    authorMap: Map<string, AuthorBundleItem>,
): CommentTreeNode[] {
    const byId = new Map<string, CommentTreeNode>();
    const nodes: CommentTreeNode[] = [];
    const roots: CommentTreeNode[] = [];

    for (const comment of comments) {
        const node: CommentTreeNode = {
            id: comment.id,
            parent_id: comment.parent_id,
            body: decodeLegacyCommentBody(comment.body),
            body_html: "",
            status: comment.status,
            is_public: comment.is_public,
            show_on_profile: comment.show_on_profile,
            date_created: comment.date_created,
            author_id: comment.author_id,
            author:
                authorMap.get(comment.author_id) ||
                createFallbackAuthor(comment.author_id),
            like_count: 0,
            liked_by_viewer: false,
            replies: [],
        };
        nodes.push(node);
        byId.set(node.id, node);
    }

    for (const node of nodes) {
        if (!node.parent_id || node.parent_id === node.id) {
            roots.push(node);
            continue;
        }
        const parent = byId.get(node.parent_id);
        if (!parent) {
            roots.push(node);
            continue;
        }
        parent.replies.push(node);
    }

    const sortByCreatedTime = (
        a: CommentTreeNode,
        b: CommentTreeNode,
    ): number => {
        const at = new Date(a.date_created || "1970-01-01").getTime();
        const bt = new Date(b.date_created || "1970-01-01").getTime();
        return at - bt;
    };

    const sortTree = (items: CommentTreeNode[]): void => {
        items.sort(sortByCreatedTime);
        for (const item of items) {
            if (item.replies.length > 0) {
                sortTree(item.replies);
            }
        }
    };

    sortTree(roots);
    return roots;
}
