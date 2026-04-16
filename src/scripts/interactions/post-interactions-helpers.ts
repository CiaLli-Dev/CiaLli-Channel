import { showConfirmDialog, showNoticeDialog } from "@/scripts/shared/dialogs";
import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/shared/i18n-runtime";
import { getCsrfToken } from "@/utils/csrf";
import type { AuthState } from "@/scripts/auth/state";

export type LikeRelationField = "article_id" | "diary_id";
type DeleteMode = "owner" | "admin";

export type FetchAllLikedIdsOptions = {
    endpoint: string;
    idField: LikeRelationField;
};

export const LIKE_SYNC_PAGE_LIMIT = 100;

export function getErrorMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    const error = data?.error as Record<string, unknown> | undefined;
    return (error?.message as string | undefined) || fallback;
}

export function normalizeRelationId(value: unknown): string {
    if (typeof value === "string" || typeof value === "number") {
        return String(value).trim();
    }
    if (value && typeof value === "object" && "id" in value) {
        const relationId = (value as { id?: unknown }).id;
        if (typeof relationId === "string" || typeof relationId === "number") {
            return String(relationId).trim();
        }
    }
    return "";
}

export async function fetchAllLikedIds({
    endpoint,
    idField,
}: FetchAllLikedIdsOptions): Promise<Set<string>> {
    const likedIds = new Set<string>();
    let page = 1;
    let total: number | null = null;
    let fetched = 0;
    let hasMore = true;

    while (hasMore) {
        const response = await fetch(
            `${endpoint}?page=${page}&limit=${LIKE_SYNC_PAGE_LIMIT}`,
            {
                credentials: "include",
            },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
            throw new Error(`failed to fetch likes list: ${endpoint}`);
        }
        if (typeof data.total === "number" && Number.isFinite(data.total)) {
            total = Math.max(0, Math.floor(data.total));
        }

        const items = data.items as Array<Record<string, unknown>>;
        fetched += items.length;
        for (const item of items) {
            const id = normalizeRelationId(item[idField]);
            if (id) {
                likedIds.add(id);
            }
        }

        hasMore = !(
            items.length < LIKE_SYNC_PAGE_LIMIT ||
            items.length === 0 ||
            (total !== null && fetched >= total)
        );
        if (hasMore) {
            page += 1;
        }
    }

    return likedIds;
}

export async function requestDeleteArticle(
    articleId: string,
    mode: DeleteMode,
): Promise<void> {
    // 管理员删除走 admin 内容端点，作者删除走 me 端点，避免权限语义混淆。
    const endpoint =
        mode === "admin"
            ? `/api/v1/admin/content/articles/${encodeURIComponent(articleId)}`
            : `/api/v1/me/articles/${encodeURIComponent(articleId)}`;
    const response = await fetch(endpoint, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": getCsrfToken() },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(
            getErrorMessage(data, t(I18nKey.interactionPostDeleteFailed)),
        );
    }
}

export async function requestDeleteDiary(
    diaryId: string,
    mode: DeleteMode,
): Promise<void> {
    // 日记删除链路与文章保持一致：管理员和作者各自走独立后端路由。
    const endpoint =
        mode === "admin"
            ? `/api/v1/admin/content/diaries/${encodeURIComponent(diaryId)}`
            : `/api/v1/me/diaries/${encodeURIComponent(diaryId)}`;
    const response = await fetch(endpoint, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": getCsrfToken() },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(
            getErrorMessage(data, t(I18nKey.interactionPostDeleteFailed)),
        );
    }
}

export async function requestToggleLike(articleId: string): Promise<{
    liked: boolean;
    like_count: number;
}> {
    const response = await fetch("/api/v1/me/article-likes", {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({
            article_id: articleId,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(
            getErrorMessage(data, t(I18nKey.interactionPostActionFailed)),
        );
    }
    return {
        liked: Boolean(data.liked),
        like_count: Number(data.like_count || 0),
    };
}

export async function requestToggleDiaryLike(diaryId: string): Promise<{
    liked: boolean;
    like_count: number;
}> {
    const response = await fetch("/api/v1/me/diary-likes", {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({
            diary_id: diaryId,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
        throw new Error(
            getErrorMessage(data, t(I18nKey.interactionPostActionFailed)),
        );
    }
    return {
        liked: Boolean(data.liked),
        like_count: Number(data.like_count || 0),
    };
}

export type CardContext = {
    cardType: "post" | "diary";
    card: HTMLElement;
    itemId: string;
    authorId: string;
};

export function resolveCardContext(actionEl: HTMLElement): CardContext | null {
    const postCard = actionEl.closest<HTMLElement>("[data-post-card]");
    if (postCard) {
        return {
            cardType: "post",
            card: postCard,
            itemId: String(postCard.dataset.articleId || ""),
            authorId: String(postCard.dataset.authorId || ""),
        };
    }
    const diaryCard = actionEl.closest<HTMLElement>("[data-diary-card]");
    if (diaryCard) {
        return {
            cardType: "diary",
            card: diaryCard,
            itemId: String(diaryCard.dataset.diaryId || ""),
            authorId: String(diaryCard.dataset.authorId || ""),
        };
    }
    return null;
}

export async function handleDeleteArticleAction(
    itemId: string,
    authorId: string,
    action: string,
    authState: AuthState,
    onSuccess: (id: string) => void,
): Promise<void> {
    const canDelete = authState.isAdmin || authState.userId === authorId;
    if (!canDelete) {
        await showNoticeDialog({
            ariaLabel: t(I18nKey.interactionDialogNoticeTitle),
            message: t(I18nKey.interactionPostNoPermissionDeleteArticle),
        });
        return;
    }
    const confirmText =
        action === "delete-admin-article"
            ? t(I18nKey.interactionPostDeleteConfirmAdminArticle)
            : t(I18nKey.interactionPostDeleteConfirmOwnArticle);
    const confirmed = await showConfirmDialog({
        ariaLabel: t(I18nKey.interactionDialogConfirmTitle),
        message: confirmText,
        confirmText: t(I18nKey.interactionCommonDelete),
        cancelText: t(I18nKey.interactionCommonCancel),
        confirmVariant: "danger",
    });
    if (!confirmed) {
        return;
    }
    try {
        const deleteMode: DeleteMode =
            action === "delete-admin-article" ? "admin" : "owner";
        await requestDeleteArticle(itemId, deleteMode);
        onSuccess(itemId);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t(I18nKey.interactionPostDeleteFailed);
        await showNoticeDialog({
            ariaLabel: t(I18nKey.interactionDialogNoticeTitle),
            message,
        });
    }
}

export async function handleDeleteDiaryAction(
    itemId: string,
    authorId: string,
    action: string,
    authState: AuthState,
    onSuccess: (id: string) => void,
): Promise<void> {
    const canDelete = authState.isAdmin || authState.userId === authorId;
    if (!canDelete) {
        await showNoticeDialog({
            ariaLabel: t(I18nKey.interactionDialogNoticeTitle),
            message: t(I18nKey.interactionPostNoPermissionDeleteDiary),
        });
        return;
    }
    const confirmText =
        action === "delete-admin-diary"
            ? t(I18nKey.interactionPostDeleteConfirmAdminDiary)
            : t(I18nKey.interactionPostDeleteConfirmOwnDiary);
    const confirmed = await showConfirmDialog({
        ariaLabel: t(I18nKey.interactionDialogConfirmTitle),
        message: confirmText,
        confirmText: t(I18nKey.interactionCommonDelete),
        cancelText: t(I18nKey.interactionCommonCancel),
        confirmVariant: "danger",
    });
    if (!confirmed) {
        return;
    }
    try {
        const deleteMode: DeleteMode =
            action === "delete-admin-diary" ? "admin" : "owner";
        await requestDeleteDiary(itemId, deleteMode);
        onSuccess(itemId);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t(I18nKey.interactionPostDeleteFailed);
        await showNoticeDialog({
            ariaLabel: t(I18nKey.interactionDialogNoticeTitle),
            message,
        });
    }
}

export type LikeButtonHelpers = {
    isLikeButtonPending: (button: HTMLButtonElement) => boolean;
    getLikeButtonCount: (button: HTMLButtonElement) => number;
    setLikeButtonPending: (
        button: HTMLButtonElement,
        isPending: boolean,
    ) => void;
    setLikeButtonState: (
        button: HTMLButtonElement,
        liked: boolean,
        likeCount?: number,
    ) => void;
};

export async function handleToggleLikeAction(
    button: HTMLButtonElement,
    cardType: "post" | "diary",
    itemId: string,
    helpers: LikeButtonHelpers,
): Promise<void> {
    if (helpers.isLikeButtonPending(button)) {
        return;
    }
    const previousLiked = button.dataset.liked === "true";
    const previousLikeCount = helpers.getLikeButtonCount(button);
    const optimisticLiked = !previousLiked;
    const optimisticLikeCount = Math.max(
        0,
        previousLikeCount + (optimisticLiked ? 1 : -1),
    );

    helpers.setLikeButtonPending(button, true);
    helpers.setLikeButtonState(button, optimisticLiked, optimisticLikeCount);
    try {
        if (cardType === "diary") {
            const result = await requestToggleDiaryLike(itemId);
            helpers.setLikeButtonState(button, result.liked, result.like_count);
        } else {
            const result = await requestToggleLike(itemId);
            helpers.setLikeButtonState(button, result.liked, result.like_count);
        }
    } catch (error) {
        helpers.setLikeButtonState(button, previousLiked, previousLikeCount);
        throw error;
    } finally {
        helpers.setLikeButtonPending(button, false);
    }
}
