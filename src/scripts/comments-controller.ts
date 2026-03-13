import {
    showAuthRequiredDialog,
    showConfirmDialog,
    showNoticeDialog,
} from "@/scripts/dialogs";
import { getCsrfToken } from "@/utils/csrf";
import {
    isToolbarAction,
    updateCommentLikeState,
    getCommentLikeSnapshot,
} from "@/scripts/comments-helpers";
import {
    buildCommentApiBase,
    buildCommentItemApi,
    buildCommentLikeApi,
    buildCommentLikePayload,
} from "@/scripts/comments-api";
import { CommentControllerLoad } from "@/scripts/comments-controller-load";

// ---- CommentController ----

export class CommentController extends CommentControllerLoad {
    // ---- 提交评论 ----

    private async flushUploadsBeforeSubmit(): Promise<boolean> {
        if (this.imagePasteUploader?.hasPendingUploads()) {
            this.setFormError("图片上传中，请稍后再提交");
        }
        const uploadsReady = this.imagePasteUploader
            ? await this.imagePasteUploader.flushPendingUploads()
            : true;
        if (!uploadsReady) {
            this.setFormError("图片上传失败，请重新粘贴后重试");
            return false;
        }
        return true;
    }

    async submitComment(): Promise<void> {
        if (!this.bodyEl || !this.submitEl || !this.parentIdEl) return;
        if (!this.currentUserId) {
            showAuthRequiredDialog("请先登录后再发表评论。");
            return;
        }
        const uploadsReady = await this.flushUploadsBeforeSubmit();
        if (!uploadsReady) return;
        const body = String(this.bodyEl.value || "").trim();
        if (!body) {
            this.setFormError("评论内容不能为空");
            return;
        }
        this.setFormError("");
        this.submitEl.disabled = true;
        this.submitEl.textContent = "提交中...";
        const overlayHandle = this.startOverlayTask({
            title: "正在提交评论",
            mode: "indeterminate",
            text: "提交中...",
        });
        try {
            await this.doSubmitComment(body, overlayHandle);
        } catch (error) {
            console.error("[comment] submit failed:", error);
            this.setFormError("评论提交失败，请稍后重试");
        } finally {
            this.submitEl.disabled = false;
            this.submitEl.textContent = "发布评论";
            this.finishOverlayTask(overlayHandle);
        }
    }

    private async doSubmitComment(
        body: string,
        overlayHandle: number | null,
    ): Promise<void> {
        if (!this.parentIdEl) return;
        this.updateOverlayTask(overlayHandle, { text: "正在提交评论..." });
        const apiBase = buildCommentApiBase(this.moduleName, this.contentId);
        const response = await fetch(apiBase, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "x-csrf-token": getCsrfToken(),
            },
            body: JSON.stringify({
                body,
                parent_id: this.parentIdEl.value || null,
            }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
            this.setFormError(data?.error?.message || "评论提交失败");
            return;
        }
        this.updateOverlayTask(overlayHandle, {
            text: "提交成功，正在刷新评论...",
        });
        await this.loadComments({ reset: true, page: 1 });
        this.closeCommentEditorOverlay();
    }

    // ---- 点赞 ----

    async toggleCommentLike(commentId: string): Promise<void> {
        if (!commentId) return;
        if (!this.currentUserId) {
            showAuthRequiredDialog("请先登录后再点赞评论。");
            return;
        }
        if (this.pendingLikeCommentIds.has(commentId)) return;
        const previousState = getCommentLikeSnapshot(this.comments, commentId);
        if (!previousState) return;
        const optimisticLiked = !previousState.liked;
        const optimisticLikeCount = Math.max(
            0,
            previousState.likeCount + (optimisticLiked ? 1 : -1),
        );
        this.pendingLikeCommentIds.add(commentId);
        updateCommentLikeState(
            this.comments,
            commentId,
            optimisticLiked,
            optimisticLikeCount,
        );
        this.renderComments();
        try {
            await this.doToggleCommentLike(commentId);
        } catch (error) {
            console.error("[comment] toggle like failed:", error);
            updateCommentLikeState(
                this.comments,
                commentId,
                previousState.liked,
                previousState.likeCount,
            );
            await showNoticeDialog({
                ariaLabel: "点赞失败",
                message:
                    error instanceof Error && error.message
                        ? error.message
                        : "点赞操作失败，请稍后重试。",
            });
        } finally {
            this.pendingLikeCommentIds.delete(commentId);
            this.renderComments();
        }
    }

    private async doToggleCommentLike(commentId: string): Promise<void> {
        const response = await fetch(buildCommentLikeApi(this.moduleName), {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "x-csrf-token": getCsrfToken(),
            },
            body: JSON.stringify(
                buildCommentLikePayload(this.moduleName, commentId),
            ),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
            throw new Error(
                data?.error?.message || "点赞操作失败，请稍后重试。",
            );
        }
        const liked = Boolean(data?.liked);
        const likeCount = Math.max(0, Number(data?.like_count || 0));
        updateCommentLikeState(this.comments, commentId, liked, likeCount);
    }

    // ---- 删除 ----

    async deleteComment(commentId: string): Promise<void> {
        const confirmed = await showConfirmDialog({
            ariaLabel: "删除确认",
            message: "确认删除这条评论？下方的回复也将一并删除。",
            confirmText: "确认删除",
            cancelText: "取消",
            confirmVariant: "danger",
        });
        if (!confirmed) return;
        const response = await fetch(
            buildCommentItemApi(this.moduleName, commentId),
            {
                method: "DELETE",
                credentials: "include",
                headers: {
                    Accept: "application/json",
                    "x-csrf-token": getCsrfToken(),
                },
            },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
            await showNoticeDialog({
                ariaLabel: "删除失败",
                message: data?.error?.message || "删除失败",
            });
            return;
        }
        await this.loadComments({ reset: true, page: 1 });
    }

    // ---- 回复折叠 ----

    toggleTopLevelReplies(parentCommentId: string): void {
        const normalizedParentId = String(parentCommentId || "").trim();
        if (!normalizedParentId) return;
        this.topLevelReplyExpandedMap = {
            ...this.topLevelReplyExpandedMap,
            [normalizedParentId]:
                !this.topLevelReplyExpandedMap[normalizedParentId],
        };
    }

    // ---- 事件绑定 ----

    private bindEditorModeButtons(): void {
        if (this.modeEditEl && !this.modeEditEl.dataset.bound) {
            this.modeEditEl.dataset.bound = "1";
            this.modeEditEl.addEventListener("click", () => {
                this.setCommentMode("edit");
            });
        }
        if (this.modePreviewEl && !this.modePreviewEl.dataset.bound) {
            this.modePreviewEl.dataset.bound = "1";
            this.modePreviewEl.addEventListener("click", () => {
                this.setCommentMode("preview");
            });
        }
    }

    private bindBodyTextarea(): void {
        if (!this.bodyEl || this.bodyEl.dataset.bound) return;
        this.bodyEl.dataset.bound = "1";
        this.bodyEl.addEventListener("input", () => {
            this.markPreviewDirty();
        });
        this.bodyEl.addEventListener("paste", (event) => {
            this.imagePasteUploader?.handlePaste(event);
        });
        this.bodyEl.addEventListener("blur", () => {
            if (!this.previewDirty) return;
            void this.requestPreview(true);
        });
    }

    private bindToolbar(): void {
        if (!this.toolbarEl || this.toolbarEl.dataset.bound) return;
        this.toolbarEl.dataset.bound = "1";
        this.toolbarEl.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const actionEl = target.closest(
                ".comment-toolbar-btn",
            ) as HTMLButtonElement | null;
            if (!actionEl) return;
            const action = String(actionEl.dataset.mdAction || "");
            if (!isToolbarAction(action)) return;
            this.applyToolbarAction(action);
        });
    }

    private bindFormSubmit(): void {
        if (!this.formEl || this.formEl.dataset.bound) return;
        this.formEl.dataset.bound = "1";
        this.formEl.addEventListener("submit", async (event) => {
            event.preventDefault();
            await this.submitComment();
        });
    }

    private bindOpenEditor(): void {
        if (!this.openEditorEl || this.openEditorEl.dataset.bound) return;
        this.openEditorEl.dataset.bound = "1";
        this.openEditorEl.addEventListener("click", () => {
            this.openCommentEditorOverlay();
        });
    }

    private bindOverlayClose(): void {
        if (!this.overlayCloseEl || this.overlayCloseEl.dataset.bound) return;
        this.overlayCloseEl.dataset.bound = "1";
        this.overlayCloseEl.addEventListener("click", () => {
            this.closeCommentEditorOverlay();
        });
    }

    private bindOverlayKeyboard(): void {
        if (!this.editorOverlayEl || this.editorOverlayEl.dataset.bound) return;
        this.editorOverlayEl.dataset.bound = "1";
        this.editorOverlayEl.addEventListener("click", (event) => {
            if (event.target !== this.editorOverlayEl) return;
            this.closeCommentEditorOverlay();
        });
        this.editorOverlayEl.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            this.closeCommentEditorOverlay();
        });
    }

    private bindSortButtons(): void {
        if (this.sortCreatedAtEl && !this.sortCreatedAtEl.dataset.bound) {
            this.sortCreatedAtEl.dataset.bound = "1";
            this.sortCreatedAtEl.addEventListener("click", () => {
                if (this.sortMode === "created_at") {
                    this.timeSortDirection =
                        this.timeSortDirection === "asc" ? "desc" : "asc";
                } else {
                    this.sortMode = "created_at";
                }
                this.renderComments();
            });
        }
        if (this.sortLikeCountEl && !this.sortLikeCountEl.dataset.bound) {
            this.sortLikeCountEl.dataset.bound = "1";
            this.sortLikeCountEl.addEventListener("click", () => {
                this.sortMode = "like_count";
                this.renderComments();
            });
        }
    }

    private bindLoadMore(): void {
        if (!this.commentLoadMoreEl || this.commentLoadMoreEl.dataset.bound)
            return;
        this.commentLoadMoreEl.dataset.bound = "1";
        this.commentLoadMoreEl.addEventListener("click", () => {
            if (this.isCommentsLoading || !this.hasMoreComments) return;
            void this.loadComments({
                reset: false,
                page: Math.max(1, this.currentCommentPage + 1),
            });
        });
    }

    private bindCommentListActions(): void {
        if (!this.commentListEl || this.commentListEl.dataset.bound) return;
        this.commentListEl.dataset.bound = "1";
        this.commentListEl.addEventListener("click", async (event) => {
            const target =
                event.target instanceof HTMLElement ? event.target : null;
            if (!target) return;
            const actionEl = target.closest(".comment-action");
            if (!(actionEl instanceof HTMLElement)) return;
            await this.handleCommentListAction(actionEl);
        });
    }

    private async handleCommentListAction(
        actionEl: HTMLElement,
    ): Promise<void> {
        const action = actionEl.dataset.action || "";
        if (action === "toggle-replies") {
            const parentId = String(actionEl.dataset.parentId || "").trim();
            if (!parentId) return;
            this.toggleTopLevelReplies(parentId);
            this.renderComments();
            return;
        }
        const id = actionEl.dataset.id || "";
        if (!id) return;
        if (action === "reply") {
            closeAllCommentActionMenus();
            this.openCommentEditorOverlay({
                parentId: id,
                authorName: actionEl.dataset.author || "用户",
            });
            return;
        }
        if (action === "delete") {
            closeAllCommentActionMenus();
            await this.deleteComment(id);
            return;
        }
        if (action === "like") {
            await this.toggleCommentLike(id);
        }
    }

    bindAllEvents(): void {
        this.bindEditorModeButtons();
        this.bindBodyTextarea();
        this.bindToolbar();
        this.bindFormSubmit();
        this.bindOpenEditor();
        this.bindOverlayClose();
        this.bindOverlayKeyboard();
        this.bindSortButtons();
        this.bindLoadMore();
        this.bindCommentListActions();
    }

    initOverlayPortal(): void {
        if (!this.editorOverlayEl) return;
        const existingOverlay = this.rw._directusCommentOverlayPortalEl;
        if (existingOverlay && existingOverlay !== this.editorOverlayEl) {
            existingOverlay.remove();
        }
        this.rw._directusCommentOverlayPortalEl = this.editorOverlayEl;
        if (this.editorOverlayEl.parentElement !== document.body) {
            document.body.appendChild(this.editorOverlayEl);
        }
    }

    initUiState(): void {
        this.isEditorOverlayOpen = false;
        this.syncOverlayUiState();
        this.setCommentMode("edit");
        this.resetPreviewState();
        this.setReplyState("", "");
        this.setFormError("");
    }
}

function closeAllCommentActionMenus(): void {
    const openedMenus = document.querySelectorAll<HTMLDetailsElement>(
        "details.comment-action-menu[open]",
    );
    openedMenus.forEach((menu) => {
        menu.removeAttribute("open");
    });
}

export { closeAllCommentActionMenus };
