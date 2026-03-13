import type { CommentItem } from "@/scripts/comments-types";
import {
    refreshMarkdownRuntime,
    collapseCommentCodeBlocks,
    getSortedCommentsForRender,
    syncTopLevelReplyExpandedState,
    appendTopLevelComments,
} from "@/scripts/comments-helpers";
import {
    buildCommentApiBase,
    buildCommentApiListUrl,
} from "@/scripts/comments-api";
import {
    renderCommentSkeletonList,
    renderCommentNodeInner,
} from "@/scripts/comments-render";
import { CommentControllerBase } from "@/scripts/comments-controller-base";

export class CommentControllerLoad extends CommentControllerBase {
    // 评论列表状态
    readonly pendingLikeCommentIds = new Set<string>();
    comments: CommentItem[] = [];
    isCommentsLoading = false;
    isLoadingMoreComments = false;
    commentLoadRequestId = 0;
    hasMoreComments = false;
    currentCommentPage = 0;
    hasLoadedInitialComments = false;
    hasDispatchedFirstLoadDone = false;

    // ---- 排序控件 ----

    updateSortButtonStyle(
        button: HTMLButtonElement | null,
        active: boolean,
    ): void {
        if (!button) return;
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.classList.toggle("text-90", active);
        button.classList.toggle("text-60", !active);
        button.classList.toggle("bg-(--btn-plain-bg-hover)", active);
        button.classList.toggle("border-(--primary)", active);
    }

    renderSortControls(): void {
        this.updateSortButtonStyle(
            this.sortCreatedAtEl,
            this.sortMode === "created_at",
        );
        this.updateSortButtonStyle(
            this.sortLikeCountEl,
            this.sortMode === "like_count",
        );
        if (this.sortCreatedAtDirectionEl) {
            this.sortCreatedAtDirectionEl.textContent =
                this.timeSortDirection === "asc" ? "↑" : "↓";
        }
    }

    // ---- 评论列表渲染 ----

    renderCommentListLoading(): void {
        if (!this.commentListEl || !this.commentEmptyEl) return;
        this.root.setAttribute("aria-busy", "true");
        this.commentEmptyEl.classList.add("hidden");
        this.commentListEl.innerHTML = renderCommentSkeletonList(3);
        this.commentLoadMoreWrapperEl?.classList.add("hidden");
    }

    renderCommentListEmpty(): void {
        if (!this.commentListEl || !this.commentEmptyEl) return;
        this.root.setAttribute("aria-busy", "false");
        if (!Array.isArray(this.comments) || this.comments.length === 0) {
            this.commentListEl.innerHTML = "";
            this.commentEmptyEl.classList.remove("hidden");
            this.commentLoadMoreWrapperEl?.classList.add("hidden");
        }
    }

    renderCommentListItems(): void {
        if (!this.commentListEl || !this.commentEmptyEl) return;
        this.commentEmptyEl.classList.add("hidden");
        const topLevelComments = getSortedCommentsForRender(
            this.comments,
            this.sortMode,
            this.timeSortDirection,
        );
        this.commentListEl.innerHTML = topLevelComments
            .map((item) =>
                renderCommentNodeInner(
                    item,
                    0,
                    this.contentAuthorId,
                    this.topLevelReplyExpandedMap,
                    this.currentUserId,
                    this.isAdmin,
                    this.pendingLikeCommentIds,
                ),
            )
            .join("");
        this.updateLoadMoreButton();
        void refreshMarkdownRuntime(this.rw);
        collapseCommentCodeBlocks(this.root, this.rw);
    }

    updateLoadMoreButton(): void {
        if (!this.commentLoadMoreWrapperEl || !this.commentLoadMoreEl) return;
        this.commentLoadMoreWrapperEl.classList.toggle(
            "hidden",
            !this.hasMoreComments,
        );
        this.commentLoadMoreEl.disabled = this.isCommentsLoading;
        this.commentLoadMoreEl.textContent = this.isLoadingMoreComments
            ? "加载中..."
            : "加载更多";
    }

    override renderComments(): void {
        if (!this.commentListEl || !this.commentEmptyEl) return;
        this.renderSortControls();
        if (this.isCommentsLoading && !this.isLoadingMoreComments) {
            this.renderCommentListLoading();
            return;
        }
        if (!this.hasLoadedInitialComments) {
            this.root.setAttribute("aria-busy", "false");
            this.commentListEl.innerHTML = "";
            this.commentEmptyEl.classList.add("hidden");
            this.commentLoadMoreWrapperEl?.classList.add("hidden");
            return;
        }
        this.root.setAttribute("aria-busy", "false");
        if (!Array.isArray(this.comments) || this.comments.length === 0) {
            this.renderCommentListEmpty();
            return;
        }
        this.renderCommentListItems();
    }

    // ---- 首次加载事件 ----

    dispatchFirstCommentLoadDone(ok: boolean): void {
        if (this.hasDispatchedFirstLoadDone) return;
        this.hasDispatchedFirstLoadDone = true;
        document.dispatchEvent(
            new CustomEvent("cialli:comments:first-load-done", {
                detail: {
                    ok,
                    module: this.moduleName,
                    contentId: this.contentId,
                },
            }),
        );
    }

    // ---- 加载评论 ----

    handleLoadCommentsError(reset: boolean, requestId: number): void {
        if (requestId !== this.commentLoadRequestId) return;
        if (reset || !this.hasLoadedInitialComments) {
            this.comments = [];
            this.topLevelReplyExpandedMap = {};
            this.currentCommentPage = 0;
            this.hasMoreComments = false;
        }
    }

    processLoadCommentsResponse(
        data: Record<string, unknown>,
        incomingItems: CommentItem[],
        reset: boolean,
        targetPage: number,
    ): void {
        this.comments = reset
            ? incomingItems
            : appendTopLevelComments(this.comments, incomingItems);
        this.currentCommentPage = Number.isFinite(Number(data.page))
            ? Math.max(1, Number(data.page))
            : targetPage;
        this.hasMoreComments = Boolean(data.has_more);
        this.topLevelReplyExpandedMap = syncTopLevelReplyExpandedState(
            this.comments,
            this.topLevelReplyExpandedMap,
        );
    }

    async loadComments(options?: {
        reset?: boolean;
        page?: number;
    }): Promise<void> {
        if (!this.directusEnabled) return;
        const reset = options?.reset ?? false;
        const targetPage =
            typeof options?.page === "number" && options.page > 0
                ? Math.floor(options.page)
                : reset
                  ? 1
                  : Math.max(1, this.currentCommentPage + 1);
        const requestId = ++this.commentLoadRequestId;
        const isFirstPageRequest = targetPage === 1;

        this.isCommentsLoading = true;
        this.isLoadingMoreComments = targetPage > 1;
        if (reset) this.hasMoreComments = false;
        this.renderComments();

        let isLoadSuccessful = false;
        try {
            isLoadSuccessful = await this.fetchAndApplyComments(
                reset,
                targetPage,
                requestId,
            );
        } catch (error) {
            console.error("[comment] load comments failed:", error);
            this.handleLoadCommentsError(reset, requestId);
        } finally {
            if (requestId === this.commentLoadRequestId) {
                if (isFirstPageRequest) {
                    this.hasLoadedInitialComments = true;
                    this.dispatchFirstCommentLoadDone(isLoadSuccessful);
                }
                this.isCommentsLoading = false;
                this.isLoadingMoreComments = false;
                this.renderComments();
            }
        }
    }

    async fetchAndApplyComments(
        reset: boolean,
        targetPage: number,
        requestId: number,
    ): Promise<boolean> {
        const apiBase = buildCommentApiBase(this.moduleName, this.contentId);
        const url = buildCommentApiListUrl(
            apiBase,
            targetPage,
            this.commentPageSize,
        );
        const response = await fetch(url, {
            headers: { Accept: "application/json" },
            credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (requestId !== this.commentLoadRequestId) return false;
        if (!response.ok || !data?.ok) {
            this.handleLoadCommentsError(reset, requestId);
            return false;
        }
        const incomingItems = Array.isArray(data.items)
            ? (data.items as CommentItem[])
            : [];
        this.processLoadCommentsResponse(
            data as Record<string, unknown>,
            incomingItems,
            reset,
            targetPage,
        );
        return true;
    }

    // ---- 加载策略 ----

    shouldUseEagerCommentLoading(): boolean {
        if (this.loadStrategy === "eager") return true;
        const searchParams = new URLSearchParams(window.location.search);
        if (searchParams.get("focus") === "comments") return true;
        const hash = String(window.location.hash || "").trim();
        return hash === "#comment-root";
    }

    triggerInitialCommentLoad(): void {
        if (this.isCommentsLoading || this.hasLoadedInitialComments) return;
        void this.loadComments({ reset: true, page: 1 });
    }

    setupCommentLoadStrategy(): void {
        if (this.shouldUseEagerCommentLoading()) {
            this.triggerInitialCommentLoad();
            return;
        }
        if (typeof IntersectionObserver === "undefined") {
            this.triggerInitialCommentLoad();
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                const shouldLoad = entries.some(
                    (entry) => entry.isIntersecting,
                );
                if (!shouldLoad) return;
                observer.disconnect();
                this.rw._directusCommentNearObserver = undefined;
                this.triggerInitialCommentLoad();
            },
            { root: null, rootMargin: "700px 0px", threshold: 0.01 },
        );
        observer.observe(this.root);
        this.rw._directusCommentNearObserver = observer;
    }
}
