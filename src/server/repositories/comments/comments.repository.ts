import type { CommentStatus } from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    countItems,
    countItemsGroupedByField,
    createOne,
    deleteOne,
    readMany,
    readOneById,
} from "@/server/directus/client";

export type CommentCollection = "app_article_comments" | "app_diary_comments";
export type CommentLikeCollection =
    | "app_article_comment_likes"
    | "app_diary_comment_likes";
type CommentLikeField = "article_comment_id" | "diary_comment_id";

function resolveCommentLikeField(
    collection: CommentLikeCollection,
): CommentLikeField {
    return collection === "app_article_comment_likes"
        ? "article_comment_id"
        : "diary_comment_id";
}

export async function readCommentById(
    collection: CommentCollection,
    commentId: string,
    fields?: string[],
): Promise<Record<string, unknown> | null> {
    return (await readOneById(
        collection,
        commentId,
        fields ? { fields } : undefined,
    )) as Record<string, unknown> | null;
}

export async function readComments(
    collection: CommentCollection | CommentLikeCollection,
    query: {
        filter?: JsonObject;
        sort?: string[];
        limit?: number;
        offset?: number;
        fields?: string[];
    },
): Promise<Array<Record<string, unknown>>> {
    return (await readMany(collection, query)) as Array<
        Record<string, unknown>
    >;
}

export async function countComments(
    collection: CommentCollection | CommentLikeCollection,
    filter: JsonObject,
): Promise<number> {
    return await countItems(collection, filter);
}

export async function countCommentLikesGrouped(
    collection: CommentLikeCollection,
    commentIds: string[],
): Promise<Map<string, number>> {
    const likeField = resolveCommentLikeField(collection);
    return await countItemsGroupedByField(collection, likeField, {
        _and: [
            { [likeField]: { _in: commentIds } },
            { status: { _eq: "published" } },
        ],
    } as JsonObject);
}

export async function readViewerCommentLikes(
    collection: CommentLikeCollection,
    commentIds: string[],
    viewerId: string,
): Promise<Array<Record<string, unknown>>> {
    const likeField = resolveCommentLikeField(collection);
    return await readComments(collection, {
        filter: {
            _and: [
                { [likeField]: { _in: commentIds } },
                { status: { _eq: "published" } },
                { user_id: { _eq: viewerId } },
            ],
        } as JsonObject,
        fields: [likeField],
        limit: -1,
    });
}

export async function deleteCommentById(
    collection: CommentCollection,
    commentId: string,
): Promise<void> {
    await deleteOne(collection, commentId);
}

export function createDiaryCommentRecord(params: {
    diaryId: string;
    authorId: string;
    input: {
        status: CommentStatus;
        parent_id?: string | null;
        body: string;
        is_public?: boolean;
        show_on_profile?: boolean;
    };
}): ReturnType<typeof createOne> {
    return createOne("app_diary_comments", {
        status: params.input.status,
        diary_id: params.diaryId,
        author_id: params.authorId,
        parent_id: params.input.parent_id,
        body: params.input.body,
        is_public: params.input.is_public,
        show_on_profile: params.input.show_on_profile,
    });
}
