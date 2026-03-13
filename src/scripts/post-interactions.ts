import {
    getAuthState,
    subscribeAuthState,
    type AuthState,
} from "@/scripts/auth-state";
import { showAuthRequiredDialog, showNoticeDialog } from "@/scripts/dialogs";
import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    fetchAllLikedIds,
    handleBlockUserAction,
    handleDeleteArticleAction,
    handleDeleteDiaryAction,
    handleToggleLikeAction,
    resolveCardContext,
    type LikeButtonHelpers,
} from "@/scripts/post-interactions-helpers";

type CalendarFilterDetail = {
    type: "day" | "month" | "year";
    key: string;
    posts: Array<{
        id: string;
        title: string;
        date: string;
        url: string;
    }>;
};

type RuntimeWindow = Window &
    typeof globalThis & {
        _calendarFilterListenerAttached?: boolean;
        _postCardActionsAttached?: boolean;
        _postInteractionsInitialized?: boolean;
    };

const runtimeWindow = window as RuntimeWindow;

function getFilterDom(): {
    postList: HTMLElement | null;
    pagination: HTMLElement | null;
} {
    return {
        postList: document.getElementById("post-list-container"),
        pagination: document.getElementById("pagination-container"),
    };
}

function isArchivePage(): boolean {
    return Boolean(document.querySelector(".archive-posts"));
}

function applyCalendarFilter(detail: CalendarFilterDetail): void {
    // archive 页面有自己的筛选系统，跳过此处理
    if (isArchivePage()) {
        return;
    }

    const { postList, pagination } = getFilterDom();
    if (!postList) {
        return;
    }
    const items = Array.from(
        postList.querySelectorAll<HTMLElement>(".post-list-item"),
    );
    items.forEach((item) => {
        const match =
            detail.type === "year"
                ? item.dataset.year === detail.key
                : detail.type === "month"
                  ? item.dataset.month === detail.key
                  : item.dataset.day === detail.key;
        item.classList.toggle("hidden", !match);
    });
    pagination?.classList.add("hidden");
}

function clearCalendarFilter(): void {
    // archive 页面有自己的筛选系统，跳过此处理
    if (isArchivePage()) {
        return;
    }

    const { postList, pagination } = getFilterDom();
    if (!postList) {
        return;
    }
    postList
        .querySelectorAll<HTMLElement>(".post-list-item.hidden")
        .forEach((item) => item.classList.remove("hidden"));
    pagination?.classList.remove("hidden");
}

function setupCalendarFilterListeners(): void {
    if (runtimeWindow._calendarFilterListenerAttached) {
        return;
    }

    window.addEventListener("calendarFilterChange", (event) => {
        const detail = (event as CustomEvent<CalendarFilterDetail>).detail;
        if (!detail || !Array.isArray(detail.posts)) {
            return;
        }
        applyCalendarFilter(detail);
    });

    window.addEventListener("calendarFilterClear", () => {
        clearCalendarFilter();
    });

    runtimeWindow._calendarFilterListenerAttached = true;
}

let currentAuthState: AuthState = {
    userId: "",
    username: "",
    isAdmin: false,
    isLoggedIn: false,
};

function updateCurrentAuthState(state: AuthState): void {
    currentAuthState = state;
}

async function applyBlockedUsersFilter(): Promise<void> {
    if (!currentAuthState.isLoggedIn) {
        return;
    }
    try {
        const response = await fetch("/api/v1/me/blocks?limit=200", {
            credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
            return;
        }
        for (const item of data.items) {
            const blockedUserId = item?.blocked_user_id
                ? String(item.blocked_user_id)
                : "";
            if (blockedUserId) {
                removeCardsByAuthorId(blockedUserId);
            }
        }
    } catch (error) {
        console.error("[PostPage] failed to apply blocked user filter:", error);
    }
}

function applyCardActionVisibility(
    card: HTMLElement,
    state: AuthState,
    deleteOwnAction: string,
    deleteAdminAction: string,
): void {
    const authorId = String(card.dataset.authorId || "");
    const deleteOwnBtn = card.querySelector<HTMLButtonElement>(
        `button[data-action="${deleteOwnAction}"]`,
    );
    const deleteAdminBtn = card.querySelector<HTMLButtonElement>(
        `button[data-action="${deleteAdminAction}"]`,
    );
    const blockBtn = card.querySelector<HTMLButtonElement>(
        'button[data-action="block-user"]',
    );
    const likeBtn = card.querySelector<HTMLButtonElement>(
        'button[data-action="toggle-like"]',
    );

    const isOwner =
        state.isLoggedIn && Boolean(state.userId) && state.userId === authorId;
    const isAdminOnly = state.isLoggedIn && state.isAdmin && !isOwner;

    deleteOwnBtn?.classList.toggle("hidden", !isOwner);
    deleteAdminBtn?.classList.toggle("hidden", !isAdminOnly);

    if (blockBtn) {
        const canBlock =
            state.isLoggedIn && Boolean(authorId) && state.userId !== authorId;
        blockBtn.classList.toggle("hidden", !canBlock);
    }

    if (likeBtn) {
        likeBtn.classList.toggle(
            "opacity-60",
            !state.isLoggedIn || isLikeButtonPending(likeBtn),
        );
    }
}

function updateCardActionVisibility(state: AuthState): void {
    const postCards =
        document.querySelectorAll<HTMLElement>("[data-post-card]");
    postCards.forEach((card) => {
        applyCardActionVisibility(
            card,
            state,
            "delete-own-article",
            "delete-admin-article",
        );
    });

    const diaryCards =
        document.querySelectorAll<HTMLElement>("[data-diary-card]");
    diaryCards.forEach((card) => {
        applyCardActionVisibility(
            card,
            state,
            "delete-own-diary",
            "delete-admin-diary",
        );
    });
}

function setLikeButtonState(
    button: HTMLButtonElement,
    liked: boolean,
    likeCount?: number,
): void {
    button.dataset.liked = liked ? "true" : "false";
    button.classList.toggle("text-(--primary)", liked);
    button.classList.toggle("text-50", !liked);
    const countEl = button.querySelector<HTMLElement>("[data-like-count]");
    if (countEl && typeof likeCount === "number") {
        const normalizedCount = Math.max(0, likeCount);
        countEl.textContent = String(normalizedCount);
        button.dataset.likeCount = String(normalizedCount);
    } else if (typeof likeCount === "number") {
        button.dataset.likeCount = String(Math.max(0, likeCount));
    }
}

function isLikeButtonPending(button: HTMLButtonElement): boolean {
    return button.dataset.likePending === "1";
}

function setLikeButtonPending(
    button: HTMLButtonElement,
    isPending: boolean,
): void {
    button.dataset.likePending = isPending ? "1" : "0";
    button.disabled = isPending;
    button.classList.toggle("pointer-events-none", isPending);
    button.classList.toggle(
        "opacity-60",
        isPending || !currentAuthState.isLoggedIn,
    );
}

function getLikeButtonCount(button: HTMLButtonElement): number {
    const datasetCount = Number(button.dataset.likeCount || "");
    if (Number.isFinite(datasetCount)) {
        return Math.max(0, datasetCount);
    }
    const countEl = button.querySelector<HTMLElement>("[data-like-count]");
    const textCount = Number(countEl?.textContent || "0");
    if (Number.isFinite(textCount)) {
        return Math.max(0, textCount);
    }
    return 0;
}

async function syncLikeButtons(): Promise<void> {
    const likeButtons = document.querySelectorAll<HTMLButtonElement>(
        'button[data-action="toggle-like"]',
    );
    if (!currentAuthState.isLoggedIn) {
        likeButtons.forEach((button) => {
            setLikeButtonPending(button, false);
            setLikeButtonState(button, false);
        });
        return;
    }

    try {
        const hasPostCards =
            document.querySelector("[data-post-card]") !== null;
        const hasDiaryCards =
            document.querySelector("[data-diary-card]") !== null;

        const [likedArticleIds, likedDiaryIds] = await Promise.all([
            hasPostCards
                ? fetchAllLikedIds({
                      endpoint: "/api/v1/me/article-likes",
                      idField: "article_id",
                  })
                : Promise.resolve(new Set<string>()),
            hasDiaryCards
                ? fetchAllLikedIds({
                      endpoint: "/api/v1/me/diary-likes",
                      idField: "diary_id",
                  })
                : Promise.resolve(new Set<string>()),
        ]);

        likeButtons.forEach((button) => {
            if (isLikeButtonPending(button)) {
                return;
            }
            const postCard = button.closest<HTMLElement>("[data-post-card]");
            if (postCard) {
                const articleId = String(
                    postCard.dataset.articleId || "",
                ).trim();
                setLikeButtonState(button, likedArticleIds.has(articleId));
                return;
            }
            const diaryCard = button.closest<HTMLElement>("[data-diary-card]");
            if (diaryCard) {
                const diaryId = String(diaryCard.dataset.diaryId || "").trim();
                setLikeButtonState(button, likedDiaryIds.has(diaryId));
            }
        });
    } catch (error) {
        console.error("[PostPage] failed to sync likes:", error);
    }
}

function removeCardByArticleId(articleId: string): void {
    const card = document.querySelector<HTMLElement>(
        `[data-post-card][data-article-id="${CSS.escape(articleId)}"]`,
    );
    if (!card) {
        return;
    }
    const row = card.closest<HTMLElement>(".post-list-item");
    row?.remove();
}

function removeCardByDiaryId(diaryId: string): void {
    const card = document.querySelector<HTMLElement>(
        `[data-diary-card][data-diary-id="${CSS.escape(diaryId)}"]`,
    );
    if (!card) {
        return;
    }
    const row = card.closest<HTMLElement>(".diary-list-item") || card;
    row.remove();
}

function removeCardsByAuthorId(authorId: string): void {
    const escaped = CSS.escape(authorId);
    const cards = document.querySelectorAll<HTMLElement>(
        `[data-post-card][data-author-id="${escaped}"], [data-diary-card][data-author-id="${escaped}"]`,
    );
    cards.forEach((card) => {
        const row =
            card.closest<HTMLElement>(".post-list-item") ||
            card.closest<HTMLElement>(".diary-list-item") ||
            card;
        row.remove();
    });
}

function buildLikeButtonHelpers(): LikeButtonHelpers {
    return {
        isLikeButtonPending,
        getLikeButtonCount,
        setLikeButtonPending,
        setLikeButtonState,
    };
}

async function handleCardAction(
    actionEl: HTMLElement,
    action: string,
): Promise<void> {
    const ctx = resolveCardContext(actionEl);
    if (!ctx || !ctx.itemId) {
        return;
    }

    const { cardType, itemId, authorId } = ctx;

    if (action === "delete-own-article" || action === "delete-admin-article") {
        await handleDeleteArticleAction(
            itemId,
            authorId,
            action,
            currentAuthState,
            removeCardByArticleId,
        );
        return;
    }

    if (action === "delete-own-diary" || action === "delete-admin-diary") {
        await handleDeleteDiaryAction(
            itemId,
            authorId,
            action,
            currentAuthState,
            removeCardByDiaryId,
        );
        return;
    }

    if (action === "toggle-like") {
        const button = actionEl as HTMLButtonElement;
        await handleToggleLikeAction(
            button,
            cardType,
            itemId,
            buildLikeButtonHelpers(),
        );
        return;
    }

    if (action === "block-user") {
        await handleBlockUserAction(
            authorId,
            currentAuthState.userId,
            removeCardsByAuthorId,
        );
        return;
    }
}

function setupMenuAuthGuard(): void {
    document.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const summary = target.closest<HTMLElement>(
            ".post-card-menu > summary",
        );
        if (summary && !currentAuthState.isLoggedIn) {
            event.preventDefault();
            showAuthRequiredDialog();
        }
    });
}

function setupCardActionHandler(): void {
    document.addEventListener("click", async (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const actionEl = target.closest<HTMLElement>("[data-action]");
        if (!actionEl) {
            return;
        }

        const ctx = resolveCardContext(actionEl);
        if (!ctx || !ctx.itemId) {
            return;
        }

        if (!currentAuthState.isLoggedIn) {
            showAuthRequiredDialog();
            return;
        }

        const details = actionEl.closest("details");
        details?.removeAttribute("open");

        const action = String(actionEl.dataset.action || "");

        try {
            await handleCardAction(actionEl, action);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : t(I18nKey.interactionPostActionFailed);
            await showNoticeDialog({
                ariaLabel: t(I18nKey.interactionDialogNoticeTitle),
                message,
            });
        }
    });
}

function setupMenuCloseOnOutsideClick(): void {
    document.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        document
            .querySelectorAll<HTMLDetailsElement>(".post-card-menu[open]")
            .forEach((menu) => {
                if (!menu.contains(target)) {
                    menu.removeAttribute("open");
                }
            });
    });
}

function setupPostCardActions(): void {
    if (runtimeWindow._postCardActionsAttached) {
        return;
    }

    setupMenuAuthGuard();
    setupCardActionHandler();
    setupMenuCloseOnOutsideClick();

    subscribeAuthState((state) => {
        updateCurrentAuthState(state);
        updateCardActionVisibility(currentAuthState);
        void applyBlockedUsersFilter();
        void syncLikeButtons();
    });

    runtimeWindow._postCardActionsAttached = true;
}

export function initPostInteractions(): void {
    if (runtimeWindow._postInteractionsInitialized) {
        return;
    }
    runtimeWindow._postInteractionsInitialized = true;

    setupCalendarFilterListeners();
    setupPostCardActions();
    updateCurrentAuthState(getAuthState());
    updateCardActionVisibility(currentAuthState);
    void (async () => {
        await applyBlockedUsersFilter();
        await syncLikeButtons();
    })();
}
