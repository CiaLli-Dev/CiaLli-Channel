import type { AuthState } from "@/scripts/auth-state";
import { showAuthRequiredDialog } from "@/scripts/dialogs";
import { MarkdownImagePasteUploader } from "@/scripts/markdown-image-paste";
import { getCsrfToken } from "@/utils/csrf";
import type {
    CommentMode,
    CommentSortMode,
    TimeSortDirection,
    TopLevelReplyExpandState,
    CommentToolbarAction,
} from "@/scripts/comments-types";
import {
    resolveBodyHtmlFromResponse,
    refreshMarkdownRuntime,
    collapseCommentCodeBlocks,
    applyWrapAction,
    applyQuoteAction,
    applyCodeBlockAction,
    resolveUserFromAuthState,
} from "@/scripts/comments-helpers";
import {
    type RuntimeWindow,
    buildCommentPreviewApi,
} from "@/scripts/comments-api";

export class CommentControllerBase {
    // 配置
    readonly root: HTMLElement;
    readonly moduleName: string;
    readonly contentId: string;
    readonly contentShortId: string;
    readonly contentAuthorId: string;
    readonly directusEnabled: boolean;
    readonly commentPageSize: number;
    readonly loadStrategy: "eager" | "nearby";
    readonly rw: RuntimeWindow;

    // DOM 元素
    readonly commentListEl: HTMLElement | null;
    readonly commentEmptyEl: HTMLElement | null;
    readonly commentLoadMoreWrapperEl: HTMLElement | null;
    readonly commentLoadMoreEl: HTMLButtonElement | null;
    readonly openEditorEl: HTMLButtonElement | null;
    readonly editorOverlayEl: HTMLDivElement | null;
    readonly formEl: HTMLFormElement | null;
    readonly bodyEl: HTMLTextAreaElement | null;
    readonly toolbarEl: HTMLElement | null;
    readonly editorPanelEl: HTMLElement | null;
    readonly previewPanelEl: HTMLElement | null;
    readonly modeEditEl: HTMLButtonElement | null;
    readonly modePreviewEl: HTMLButtonElement | null;
    readonly previewLoadingEl: HTMLElement | null;
    readonly previewErrorEl: HTMLElement | null;
    readonly previewEmptyEl: HTMLElement | null;
    readonly previewContentEl: HTMLElement | null;
    readonly sortCreatedAtEl: HTMLButtonElement | null;
    readonly sortCreatedAtDirectionEl: HTMLElement | null;
    readonly sortLikeCountEl: HTMLButtonElement | null;
    readonly parentIdEl: HTMLInputElement | null;
    readonly overlayCloseEl: HTMLButtonElement | null;
    readonly submitEl: HTMLButtonElement | null;
    readonly formErrorEl: HTMLElement | null;
    readonly replyHintEl: HTMLElement | null;

    // 状态
    currentUserId = "";
    isAdmin = false;
    isEditorOverlayOpen = false;
    commentMode: CommentMode = "edit";
    previewSource = "";
    previewHtml = "";
    previewError = "";
    previewLoading = false;
    previewDirty = false;
    previewRequestId = 0;
    renderedPreviewHtml = "";
    sortMode: CommentSortMode = "created_at";
    timeSortDirection: TimeSortDirection = "asc";
    topLevelReplyExpandedMap: TopLevelReplyExpandState = {};
    readonly imagePasteUploader: MarkdownImagePasteUploader | null;

    constructor(root: HTMLElement, rw: RuntimeWindow) {
        this.root = root;
        this.rw = rw;

        this.moduleName = String(root.dataset.module || "").trim();
        this.contentId = String(root.dataset.contentId || "").trim();
        this.contentShortId = String(root.dataset.contentShortId || "").trim();
        this.contentAuthorId = String(
            root.dataset.contentAuthorId || "",
        ).trim();
        this.directusEnabled = root.dataset.directusEnabled === "1";
        this.loadStrategy =
            root.dataset.loadStrategy === "eager" ? "eager" : "nearby";
        const pageSizeRaw = Number(root.dataset.pageSize || "20");
        this.commentPageSize =
            Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
                ? Math.min(50, Math.floor(pageSizeRaw))
                : 20;

        this.commentListEl = document.getElementById("comment-list");
        this.commentEmptyEl = document.getElementById("comment-empty");
        this.commentLoadMoreWrapperEl = document.getElementById(
            "comment-load-more-wrapper",
        );
        this.commentLoadMoreEl = document.getElementById(
            "comment-load-more",
        ) as HTMLButtonElement | null;
        this.openEditorEl = document.getElementById(
            "comment-open-editor",
        ) as HTMLButtonElement | null;
        this.editorOverlayEl = document.getElementById(
            "comment-editor-overlay",
        ) as HTMLDivElement | null;
        this.formEl = document.getElementById(
            "comment-create-form",
        ) as HTMLFormElement | null;
        this.bodyEl = document.getElementById(
            "comment-body",
        ) as HTMLTextAreaElement | null;
        this.toolbarEl = document.getElementById("comment-toolbar");
        this.editorPanelEl = document.getElementById("comment-editor-panel");
        this.previewPanelEl = document.getElementById("comment-preview-panel");
        this.modeEditEl = document.getElementById(
            "comment-mode-edit",
        ) as HTMLButtonElement | null;
        this.modePreviewEl = document.getElementById(
            "comment-mode-preview",
        ) as HTMLButtonElement | null;
        this.previewLoadingEl = document.getElementById(
            "comment-preview-loading",
        );
        this.previewErrorEl = document.getElementById("comment-preview-error");
        this.previewEmptyEl = document.getElementById("comment-preview-empty");
        this.previewContentEl = document.getElementById(
            "comment-preview-content",
        );
        this.sortCreatedAtEl = document.getElementById(
            "comment-sort-created-at",
        ) as HTMLButtonElement | null;
        this.sortCreatedAtDirectionEl = document.getElementById(
            "comment-sort-created-at-direction",
        );
        this.sortLikeCountEl = document.getElementById(
            "comment-sort-like-count",
        ) as HTMLButtonElement | null;
        this.parentIdEl = document.getElementById(
            "comment-parent-id",
        ) as HTMLInputElement | null;
        this.overlayCloseEl = document.getElementById(
            "comment-overlay-close",
        ) as HTMLButtonElement | null;
        this.submitEl = document.getElementById(
            "comment-submit",
        ) as HTMLButtonElement | null;
        this.formErrorEl = document.getElementById("comment-form-error");
        this.replyHintEl = document.getElementById("comment-reply-hint");

        this.imagePasteUploader = this.bodyEl
            ? new MarkdownImagePasteUploader({
                  textarea: this.bodyEl,
                  fileNamePrefix: "comment",
                  shortId: this.contentShortId,
                  autoUpload: false,
                  buildUploadTitle: ({ shortId, sequence }) =>
                      `Comment ${shortId}-CMT-${String(sequence).padStart(2, "0")}`,
                  buildAssetUrl: (fileId) =>
                      `/api/v1/public/assets/${encodeURIComponent(fileId)}?width=960&fit=inside&quality=82&format=webp`,
                  onContentChange: () => {
                      this.markPreviewDirty();
                      if (this.commentMode === "preview") {
                          void this.requestPreview();
                      }
                  },
                  onError: (message) => {
                      this.setFormError(message);
                  },
              })
            : null;
    }

    // ---- Overlay 任务辅助 ----

    startOverlayTask(options: Record<string, unknown>): number | null {
        const po = this.rw.__CIALLI_PROGRESS_OVERLAY__;
        if (!po) return null;
        return po.startTask({ delayMs: 300, ...options });
    }

    updateOverlayTask(
        handle: number | null,
        stage: Record<string, unknown>,
    ): void {
        const po = this.rw.__CIALLI_PROGRESS_OVERLAY__;
        if (!po || typeof handle !== "number") return;
        po.updateTask(handle, stage);
    }

    finishOverlayTask(handle: number | null): void {
        const po = this.rw.__CIALLI_PROGRESS_OVERLAY__;
        if (!po || typeof handle !== "number") return;
        po.finishTask(handle);
    }

    // ---- 编辑器 Overlay ----

    setFormError(message: string): void {
        if (!this.formErrorEl) return;
        if (!message) {
            this.formErrorEl.classList.add("hidden");
            this.formErrorEl.textContent = "";
            return;
        }
        this.formErrorEl.textContent = message;
        this.formErrorEl.classList.remove("hidden");
    }

    setReplyState(parentId: string, authorName: string): void {
        if (!this.parentIdEl || !this.replyHintEl) return;
        this.parentIdEl.value = parentId || "";
        this.replyHintEl.textContent = parentId
            ? `正在回复 ${authorName || "该用户"}`
            : "";
    }

    markPreviewDirty(): void {
        this.previewDirty = true;
    }

    syncOverlayUiState(): void {
        if (!this.editorOverlayEl) return;
        this.editorOverlayEl.classList.toggle(
            "hidden",
            !this.isEditorOverlayOpen,
        );
        this.editorOverlayEl.setAttribute(
            "aria-hidden",
            this.isEditorOverlayOpen ? "false" : "true",
        );
        document.body.classList.toggle(
            "dc-comment-editor-overlay-lock",
            this.isEditorOverlayOpen,
        );
    }

    clearCommentEditorState(): void {
        if (this.bodyEl) this.bodyEl.value = "";
        this.setReplyState("", "");
        this.setCommentMode("edit");
        this.resetPreviewState();
        this.setFormError("");
    }

    closeCommentEditorOverlay(): void {
        if (!this.isEditorOverlayOpen) return;
        this.isEditorOverlayOpen = false;
        this.clearCommentEditorState();
        this.syncOverlayUiState();
    }

    openCommentEditorOverlay(options?: {
        parentId?: string;
        authorName?: string;
    }): void {
        if (!this.currentUserId) {
            showAuthRequiredDialog("请先登录后再发表评论。");
            return;
        }
        this.clearCommentEditorState();
        const parentId = String(options?.parentId || "").trim();
        const authorName = String(options?.authorName || "").trim();
        if (parentId) {
            this.setReplyState(parentId, authorName || "用户");
        }
        this.isEditorOverlayOpen = true;
        this.syncOverlayUiState();
        window.setTimeout(() => {
            this.bodyEl?.focus();
        }, 0);
    }

    // ---- 模式切换 ----

    updateModeButtonStyle(
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

    setCommentMode(mode: CommentMode): void {
        this.commentMode = mode;
        if (this.editorPanelEl) {
            this.editorPanelEl.classList.toggle("hidden", mode !== "edit");
        }
        if (this.previewPanelEl) {
            this.previewPanelEl.classList.toggle("hidden", mode !== "preview");
        }
        this.updateModeButtonStyle(this.modeEditEl, mode === "edit");
        this.updateModeButtonStyle(this.modePreviewEl, mode === "preview");
        if (mode === "preview") {
            void this.requestPreview();
        }
    }

    // ---- 预览 ----

    renderPreview(): void {
        if (
            !this.previewLoadingEl ||
            !this.previewErrorEl ||
            !this.previewEmptyEl ||
            !this.previewContentEl
        ) {
            return;
        }
        this.previewLoadingEl.classList.toggle("hidden", !this.previewLoading);
        this.renderPreviewError();
        this.renderPreviewContent();
    }

    renderPreviewError(): void {
        if (!this.previewErrorEl) return;
        if (this.previewError) {
            this.previewErrorEl.textContent = this.previewError;
            this.previewErrorEl.classList.remove("hidden");
        } else {
            this.previewErrorEl.textContent = "";
            this.previewErrorEl.classList.add("hidden");
        }
    }

    renderPreviewContent(): void {
        if (!this.previewContentEl || !this.previewEmptyEl) return;
        if (this.previewHtml) {
            if (this.renderedPreviewHtml !== this.previewHtml) {
                this.previewContentEl.innerHTML = this.previewHtml;
                this.renderedPreviewHtml = this.previewHtml;
                void refreshMarkdownRuntime(this.rw);
                collapseCommentCodeBlocks(this.root, this.rw);
            }
            this.previewContentEl.classList.remove("hidden");
            this.previewEmptyEl.classList.add("hidden");
            return;
        }
        this.previewContentEl.innerHTML = "";
        this.renderedPreviewHtml = "";
        this.previewContentEl.classList.add("hidden");
        this.previewEmptyEl.classList.remove("hidden");
    }

    resetPreviewState(): void {
        this.previewSource = "";
        this.previewHtml = "";
        this.previewError = "";
        this.previewLoading = false;
        this.previewDirty = false;
        this.previewRequestId += 1;
        this.renderedPreviewHtml = "";
        this.renderPreview();
    }

    async requestPreviewEmpty(source: string): Promise<void> {
        this.previewSource = source;
        this.previewHtml = "";
        this.previewError = "";
        this.previewLoading = false;
        this.previewDirty = false;
        this.renderPreview();
    }

    async requestPreviewNotLoggedIn(source: string): Promise<void> {
        this.previewSource = source;
        this.previewHtml = "";
        this.previewError = "请先登录后预览评论内容。";
        this.previewLoading = false;
        this.previewDirty = false;
        this.renderPreview();
    }

    async requestPreviewFetch(
        text: string,
        source: string,
        force: boolean,
    ): Promise<void> {
        this.previewLoading = true;
        this.previewError = "";
        this.renderPreview();
        const requestId = ++this.previewRequestId;
        const renderMode = force ? "full" : "fast";
        try {
            const response = await fetch(
                buildCommentPreviewApi(this.moduleName),
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "x-csrf-token": getCsrfToken(),
                    },
                    body: JSON.stringify({
                        body: text,
                        render_mode: renderMode,
                    }),
                },
            );
            const data = await response.json().catch(() => null);
            if (requestId !== this.previewRequestId) return;
            if (!response.ok || !data?.ok) {
                this.previewHtml = "";
                this.previewError = data?.error?.message || "预览生成失败";
                this.previewDirty = true;
                return;
            }
            this.previewHtml = resolveBodyHtmlFromResponse(data);
            this.previewSource = source;
            this.previewError = "";
            this.previewDirty = false;
        } catch (error) {
            console.error("[comment] preview render failed:", error);
            if (requestId !== this.previewRequestId) return;
            this.previewHtml = "";
            this.previewError = "预览生成失败，请稍后重试";
            this.previewDirty = true;
        } finally {
            if (requestId === this.previewRequestId) {
                this.previewLoading = false;
                this.renderPreview();
            }
        }
    }

    async requestPreview(force = false): Promise<void> {
        if (!this.bodyEl) return;
        const source = String(this.bodyEl.value || "");
        const text = source.trim();
        if (!force && !this.previewDirty && source === this.previewSource)
            return;
        if (!text) {
            await this.requestPreviewEmpty(source);
            return;
        }
        if (!this.currentUserId) {
            await this.requestPreviewNotLoggedIn(source);
            return;
        }
        await this.requestPreviewFetch(text, source, force);
    }

    // ---- Toolbar ----

    applyToolbarAction(action: CommentToolbarAction): void {
        if (!this.bodyEl) return;
        const onDirty = (): void => {
            this.markPreviewDirty();
        };
        if (action === "bold") {
            applyWrapAction(this.bodyEl, "**", "**", "粗体文本", onDirty);
        } else if (action === "italic") {
            applyWrapAction(this.bodyEl, "*", "*", "斜体文本", onDirty);
        } else if (action === "underline") {
            applyWrapAction(this.bodyEl, "<u>", "</u>", "下划线文本", onDirty);
        } else if (action === "strike") {
            applyWrapAction(this.bodyEl, "~~", "~~", "删除线文本", onDirty);
        } else if (action === "quote") {
            applyQuoteAction(this.bodyEl, onDirty);
        } else if (action === "inline-code") {
            applyWrapAction(this.bodyEl, "`", "`", "代码", onDirty);
        } else if (action === "code-block") {
            applyCodeBlockAction(this.bodyEl, onDirty);
        }
    }

    // ---- Auth ----

    applyAuthState(state: AuthState): void {
        const { userId, isAdmin } = resolveUserFromAuthState(state);
        this.currentUserId = userId;
        this.isAdmin = isAdmin;
        this.renderComments();
        if (this.commentMode === "preview" && this.previewDirty) {
            void this.requestPreview(true);
        }
    }

    // 由子类实现
    renderComments(): void {
        // overridden in subclass
    }
}
