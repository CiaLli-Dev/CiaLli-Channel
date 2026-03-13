import type { ArticleInteractionSnapshot } from "@/server/repositories/article/interaction.repository";
export type { ArticleInteractionSnapshot } from "@/server/repositories/article/interaction.repository";
import {
    invalidateArticleInteractionAggregateFromRepository,
    invalidateArticleInteractionViewerStateFromRepository,
    loadArticleInteractionSnapshotFromRepository,
} from "@/server/repositories/article/interaction.repository";

export async function loadArticleInteractionSnapshot(input: {
    articleId: string;
    viewerId?: string | null;
}): Promise<ArticleInteractionSnapshot> {
    return await loadArticleInteractionSnapshotFromRepository(input);
}

export async function invalidateArticleInteractionAggregate(
    articleId: string,
): Promise<void> {
    await invalidateArticleInteractionAggregateFromRepository(articleId);
}

export async function invalidateArticleInteractionViewerState(
    articleId: string,
    viewerId: string,
): Promise<void> {
    await invalidateArticleInteractionViewerStateFromRepository(
        articleId,
        viewerId,
    );
}
