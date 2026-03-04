/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
/**
 * 发布中心页面逻辑 — 纯文章编辑器
 *
 * - VSCode 风格双栏布局（左编辑、右实时预览）
 * - 封面裁剪上传 + 正文粘贴即上传
 * - 所有上传暂存本地、发布时统一上传
 */

import {
    emitAuthState,
    getAuthState,
    subscribeAuthState,
    type AuthState,
} from "@/scripts/auth-state";
import { ImageCropModal } from "@/scripts/image-crop-modal";
import { MarkdownPreviewClient } from "@/scripts/markdown-preview-client";
import { SaveProgressOverlay } from "@/scripts/save-progress-overlay";
import { ARTICLE_TITLE_MAX, charWeight } from "@/constants/text-limits";
import I18nKey from "@/i18n/i18nKey";
import type { PublishEditorAdapter } from "@/scripts/publish-editor-adapter";
import { createPublishEditorAdapter } from "@/scripts/publish-editor-monaco";
import { requestApi as api } from "@/scripts/http-client";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { generateClientShortId } from "@/utils/short-id";
import {
    type PendingUpload,
    type PublishRuntimeWindow,
    COVER_OUTPUT_WIDTH,
    COVER_OUTPUT_HEIGHT,
    applyToolbarAction,
    arrayToCsv,
    clearPendingUploads,
    getApiMessage,
    getImageFileExt,
    isProtectedContentBody,
    removePendingCover,
    toBooleanValue,
    toRecord,
    toStringArrayValue,
    toStringValue,
    trimToWeightedMax,
} from "@/scripts/publish-page-helpers";
import {
    type PublishDomRefs,
    collectDomRefs,
} from "@/scripts/publish-page-dom";
import {
    type PublishState,
    type UiHelpers,
    fillEncryptedBody,
    submit,
} from "@/scripts/publish-page-submit";
import {
    type PreviewHelpers,
    makePreviewHelpers,
} from "@/scripts/publish-page-preview";
import { makeUiHelpers } from "@/scripts/publish-page-ui";
import { setupUnsavedChangesGuard } from "@/scripts/unsaved-changes-guard";

// ── 常量（依赖 i18n，在模块顶层初始化）──

const TITLE_TOO_LONG_MESSAGE = tFmt(I18nKey.articleEditorTitleMaxLength, {
    max: ARTICLE_TITLE_MAX,
});
const DEFAULT_BODY_PLACEHOLDER = t(I18nKey.articleEditorBodyPlaceholder);
let disposeActivePublishPage: (() => void) | null = null;
let activePublishPageController: AbortController | null = null;

function buildPublishDraftSnapshot(
    dom: PublishDomRefs,
    state: PublishState,
    pendingUploads: Map<string, PendingUpload>,
): string {
    // 用稳定快照判断是否存在“未保存改动”，避免依赖单一 dirty 标记误判。
    const pendingUploadKeys = Array.from(pendingUploads.values())
        .map((item) => `${item.purpose}:${item.fileName}:${item.localUrl}`)
        .sort();
    return JSON.stringify({
        title: String(dom.articleTitleInput.value || ""),
        summary: String(dom.articleSummaryInput.value || ""),
        body: String(dom.articleBodyInput.value || ""),
        coverUrl: String(dom.articleCoverUrlInput.value || ""),
        tags: String(dom.articleTagsInput.value || ""),
        category: String(dom.articleCategoryInput.value || ""),
        allowComments: dom.articleAllowCommentsInput.checked,
        isPublic: dom.articleIsPublicInput.checked,
        encryptEnabled: dom.articleEncryptEnabledInput.checked,
        encryptPassword: String(dom.articleEncryptPasswordInput.value || ""),
        coverFileId: state.currentCoverFileId,
        pendingUploadKeys,
    });
}

// ── 表单操作 ──

async function fillArticleForm(
    dom: PublishDomRefs,
    editor: PublishEditorAdapter,
    state: PublishState,
    updateEncryptPanel: () => void,
    updateCoverPreview: () => void,
    updateTitleHint: () => void,
    item: Record<string, unknown>,
): Promise<boolean> {
    dom.articleTitleInput.value = toStringValue(item.title);
    dom.articleSummaryInput.value = toStringValue(item.summary);
    const rawBodyMarkdown = toStringValue(item.body_markdown);
    const isEncryptedBody = isProtectedContentBody(rawBodyMarkdown);
    let unlockedEncryptedBody = false;
    if (isEncryptedBody) {
        unlockedEncryptedBody = await fillEncryptedBody(
            dom,
            state,
            rawBodyMarkdown,
            item,
            DEFAULT_BODY_PLACEHOLDER,
        );
    } else {
        state.loadedEncryptedBody = "";
        state.loadedEncryptedBodyUnlocked = false;
        dom.articleEncryptEnabledInput.checked = false;
        dom.articleBodyInput.value = rawBodyMarkdown;
        dom.articleBodyInput.placeholder = DEFAULT_BODY_PLACEHOLDER;
        dom.articleEncryptPasswordInput.value = "";
    }
    editor.setValue(dom.articleBodyInput.value);
    updateEncryptPanel();
    dom.articleCoverUrlInput.value = toStringValue(item.cover_url);
    dom.articleTagsInput.value = arrayToCsv(toStringArrayValue(item.tags));
    dom.articleCategoryInput.value = toStringValue(item.category);
    dom.articleAllowCommentsInput.checked = toBooleanValue(
        item.allow_comments,
        true,
    );
    dom.articleIsPublicInput.checked = toBooleanValue(item.is_public, true);
    state.currentCoverFileId = toStringValue(item.cover_file);
    updateCoverPreview();
    updateTitleHint();
    return unlockedEncryptedBody;
}

// ── 事件绑定 ──

type PageContext = {
    dom: PublishDomRefs;
    editor: PublishEditorAdapter;
    state: PublishState;
    pendingUploads: Map<string, PendingUpload>;
    saveOverlay: SaveProgressOverlay;
    previewClient: MarkdownPreviewClient;
    ui: UiHelpers;
    preview: PreviewHelpers;
    cropModal: ImageCropModal;
    clientShortId: string;
    updateCoverPreview: () => void;
    fillForm: (item: Record<string, unknown>) => Promise<boolean>;
    resetForm: () => void;
    loadDetail: (id: string) => Promise<void>;
};

function bindEditorEvents(ctx: PageContext): void {
    const { dom, editor, state, ui, preview } = ctx;

    dom.toolbarEl.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const button = target.closest<HTMLButtonElement>("[data-md-action]");
        if (!button) {
            return;
        }
        const action = toStringValue(button.dataset.mdAction);
        applyToolbarAction(action, editor, preview.markPreviewDirty);
    });

    dom.articleTitleInput.addEventListener("input", () => {
        const raw = String(dom.articleTitleInput.value || "");
        const limited = trimToWeightedMax(raw, ARTICLE_TITLE_MAX, charWeight);
        if (raw !== limited) {
            dom.articleTitleInput.value = limited;
            ui.setSubmitError(TITLE_TOO_LONG_MESSAGE);
        }
        ui.updateTitleHint();
    });

    dom.articleEncryptEnabledInput.addEventListener("change", () => {
        ui.updateEncryptPanel();
    });

    editor.onInput(() => {
        ui.updateEncryptHint();
        preview.markPreviewDirty();
    });

    editor.onBlur(() => {
        if (!state.previewDirty) {
            return;
        }
        if (state.previewFastTimer !== null) {
            window.clearTimeout(state.previewFastTimer);
            state.previewFastTimer = null;
        }
        if (state.previewFullTimer !== null) {
            window.clearTimeout(state.previewFullTimer);
            state.previewFullTimer = null;
        }
        const generation = state.previewGeneration;
        void preview.requestPreview("full", generation, true);
    });

    editor.onPaste((event: ClipboardEvent) => {
        const items = event.clipboardData?.items;
        if (!items) {
            return;
        }
        for (const item of items) {
            if (!item.type.startsWith("image/")) {
                continue;
            }
            const file = item.getAsFile();
            if (!file) {
                continue;
            }
            event.preventDefault();
            const localUrl = URL.createObjectURL(file);
            state.inlineImageCounter += 1;
            const ext = getImageFileExt(file);
            const fileName = `${ctx.clientShortId}-${state.inlineImageCounter}.${ext}`;
            ctx.pendingUploads.set(localUrl, {
                file,
                localUrl,
                purpose: "inline",
                fileName,
            });
            const markdown = `![image](${localUrl})`;
            editor.replaceSelection(markdown, markdown.length, markdown.length);
            preview.markPreviewDirty();
            break;
        }
    });
}

function bindScrollSync(
    editor: PublishEditorAdapter,
    previewScrollEl: HTMLElement | null,
): void {
    let syncScrollSource: "editor" | "preview" | null = null;
    let syncScrollTimer: number | null = null;

    const syncScroll = (
        source: {
            scrollTop: number;
            scrollHeight: number;
            clientHeight: number;
        },
        applyTargetScrollTop: (scrollTop: number) => void,
        origin: "editor" | "preview",
    ): void => {
        if (syncScrollSource && syncScrollSource !== origin) {
            return;
        }
        syncScrollSource = origin;
        if (syncScrollTimer !== null) {
            window.clearTimeout(syncScrollTimer);
        }
        syncScrollTimer = window.setTimeout(() => {
            syncScrollSource = null;
            syncScrollTimer = null;
        }, 80);
        const sourceMax = source.scrollHeight - source.clientHeight;
        if (sourceMax <= 0) {
            return;
        }
        const ratio = source.scrollTop / sourceMax;
        const targetState =
            origin === "editor"
                ? {
                      scrollHeight: previewScrollEl?.scrollHeight || 0,
                      clientHeight: previewScrollEl?.clientHeight || 0,
                  }
                : {
                      scrollHeight: editor.getScrollState().scrollHeight,
                      clientHeight: editor.getScrollState().clientHeight,
                  };
        const targetMax = targetState.scrollHeight - targetState.clientHeight;
        applyTargetScrollTop(targetMax <= 0 ? 0 : ratio * targetMax);
    };

    editor.onScroll(() => {
        if (!previewScrollEl) {
            return;
        }
        syncScroll(
            editor.getScrollState(),
            (nextScrollTop: number) => {
                previewScrollEl.scrollTop = nextScrollTop;
            },
            "editor",
        );
    });

    previewScrollEl?.addEventListener("scroll", () => {
        syncScroll(
            {
                scrollTop: previewScrollEl.scrollTop,
                scrollHeight: previewScrollEl.scrollHeight,
                clientHeight: previewScrollEl.clientHeight,
            },
            (nextScrollTop: number) => {
                editor.setScrollTop(nextScrollTop);
            },
            "preview",
        );
    });
}

function bindCoverEvents(ctx: PageContext): void {
    const {
        dom,
        state,
        ui,
        cropModal,
        updateCoverPreview,
        pendingUploads,
        clientShortId,
    } = ctx;

    dom.coverCropBtn?.addEventListener("click", () => {
        void (async () => {
            const blob = await cropModal.open();
            if (!blob) {
                return;
            }
            removePendingCover(pendingUploads);
            const localUrl = URL.createObjectURL(blob);
            const ext = blob.type === "image/png" ? "png" : "jpg";
            const fileName = `${clientShortId}-cover.${ext}`;
            const file = new File([blob], fileName, { type: blob.type });
            pendingUploads.set(localUrl, {
                file,
                localUrl,
                purpose: "cover",
                fileName,
            });
            state.currentCoverFileId = "";
            updateCoverPreview();
            ui.setCoverMessage(t(I18nKey.articleEditorCoverUpdatedPendingSave));
        })();
    });

    dom.coverClearBtn?.addEventListener("click", () => {
        removePendingCover(pendingUploads);
        state.currentCoverFileId = "";
        dom.articleCoverUrlInput.value = "";
        updateCoverPreview();
        ui.setCoverMessage("");
    });

    dom.articleCoverUrlInput.addEventListener("input", () => {
        updateCoverPreview();
    });
}

function bindSubmitAndAuth(ctx: PageContext, initialIdFromUrl: string): void {
    const {
        dom,
        state,
        ui,
        pendingUploads,
        saveOverlay,
        previewClient,
        fillForm,
        resetForm,
        loadDetail,
    } = ctx;

    dom.savePublishedBtn.addEventListener("click", () => {
        void submit({
            dom,
            state,
            pendingUploads,
            saveOverlay,
            previewClient,
            ui,
            fillForm,
        });
    });

    const applyAuthState = (authState: AuthState): void => {
        state.isLoggedIn = authState.isLoggedIn;
        state.currentUsername = toStringValue(authState.username);
        dom.workspaceEl.classList.toggle("hidden", !state.isLoggedIn);
        if (!state.isLoggedIn) {
            return;
        }
        if (!state.initializedAfterLogin) {
            state.initializedAfterLogin = true;
            void (async () => {
                if (initialIdFromUrl) {
                    await loadDetail(initialIdFromUrl);
                } else {
                    resetForm();
                }
            })();
        }
    };

    subscribeAuthState((authState) => {
        applyAuthState(authState);
    });
    applyAuthState(getAuthState());

    void (async () => {
        if (getAuthState().isLoggedIn) {
            return;
        }
        try {
            const { response, data } = await api("/api/auth/me", {
                method: "GET",
                headers: { "Cache-Control": "no-store" },
            });
            if (!response.ok || !data?.ok) {
                return;
            }
            const user = toRecord(data.user);
            emitAuthState({
                isLoggedIn: true,
                isAdmin: Boolean(data.is_admin || data.isAdmin),
                userId: toStringValue(user?.id),
                username: toStringValue(user?.username),
            });
        } catch (error) {
            console.warn("[publish] hydrate auth state failed:", error);
        }
    })();
}

function bindSettingsOverlay(): void {
    const settingsOverlay = document.getElementById("publish-settings-overlay");
    const openSettingsBtn = document.getElementById("publish-open-settings");
    const cancelSettingsBtn = document.getElementById(
        "publish-cancel-settings",
    );

    function openSettingsOverlay(): void {
        if (settingsOverlay) {
            settingsOverlay.hidden = false;
            document.body.style.overflow = "hidden";
        }
    }

    function closeSettingsOverlay(): void {
        if (settingsOverlay) {
            settingsOverlay.hidden = true;
            document.body.style.overflow = "";
        }
    }

    openSettingsBtn?.addEventListener("click", openSettingsOverlay);
    cancelSettingsBtn?.addEventListener("click", closeSettingsOverlay);
    settingsOverlay?.addEventListener("click", (event) => {
        if (event.target === settingsOverlay) {
            closeSettingsOverlay();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (
            event.key === "Escape" &&
            settingsOverlay &&
            !settingsOverlay.hidden
        ) {
            closeSettingsOverlay();
        }
    });
}

// ── 主函数 ──

async function initPublishPageCore(): Promise<void> {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const isNewPage = path === "/posts/new";
    const editMatch = path.match(/^\/posts\/([^/]+)\/edit$/);
    if (!isNewPage && !editMatch) {
        return;
    }

    const root = document.getElementById("publish-root");
    if (!root || root.dataset.publishBound === "1") {
        return;
    }
    root.dataset.publishBound = "1";
    // 页面重新进入前先释放上一轮实例，避免监听器与编辑器残留。
    disposeActivePublishPage?.();
    activePublishPageController?.abort();
    activePublishPageController = null;

    const runtimeWindow = window as PublishRuntimeWindow;
    const dom = collectDomRefs();
    if (!dom) {
        return;
    }

    let editor: PublishEditorAdapter;
    try {
        editor = await createPublishEditorAdapter({
            textareaEl: dom.articleBodyInput,
            monacoHostEl: dom.editorMonacoEl,
        });
    } catch (error) {
        console.error("[publish] monaco init failed:", error);
        dom.submitErrorEl.textContent = t(I18nKey.articleEditorLoadFailedRetry);
        dom.submitErrorEl.classList.remove("hidden");
        return;
    }

    const initialIdFromUrl = root.dataset.articleId || "";
    const clientShortId = generateClientShortId();
    const previewClient = new MarkdownPreviewClient("article");
    const saveOverlay = new SaveProgressOverlay();
    const pendingUploads = new Map<string, PendingUpload>();
    const cropModal = new ImageCropModal({
        outputWidth: COVER_OUTPUT_WIDTH,
        outputHeight: COVER_OUTPUT_HEIGHT,
        title: t(I18nKey.articleEditorCoverCropTitle),
    });

    const state: PublishState = {
        currentItemId: "",
        currentItemShortId: "",
        currentCoverFileId: "",
        currentUsername: "",
        isLoggedIn: false,
        previewError: "",
        previewHtml: "",
        previewSource: "",
        previewDirty: false,
        renderedPreviewHtml: "",
        previewGeneration: 0,
        previewFastTimer: null,
        previewFullTimer: null,
        initializedAfterLogin: false,
        loadedEncryptedBody: "",
        loadedEncryptedBodyUnlocked: false,
        inlineImageCounter: 0,
    };
    let savedDraftSnapshot = "";

    const ui = makeUiHelpers(dom, state);
    const updateCoverPreview = (): void =>
        ui.updateCoverPreview(pendingUploads);
    const preview = makePreviewHelpers(
        dom,
        state,
        previewClient,
        runtimeWindow,
    );

    const markDraftSaved = (): void => {
        savedDraftSnapshot = buildPublishDraftSnapshot(
            dom,
            state,
            pendingUploads,
        );
    };
    const hasUnsavedDraftChanges = (): boolean => {
        // 不能用按钮 disabled 作为“无未保存改动”依据：
        // 按钮可能因 UI 态被禁用，但表单实际仍有变更。
        return (
            buildPublishDraftSnapshot(dom, state, pendingUploads) !==
            savedDraftSnapshot
        );
    };

    const fillForm = async (
        item: Record<string, unknown>,
    ): Promise<boolean> => {
        const unlocked = await fillArticleForm(
            dom,
            editor,
            state,
            ui.updateEncryptPanel,
            updateCoverPreview,
            ui.updateTitleHint,
            item,
        );
        markDraftSaved();
        return unlocked;
    };

    const resetForm = (): void => {
        dom.articleTitleInput.value = "";
        dom.articleSummaryInput.value = "";
        editor.setValue("");
        dom.articleBodyInput.placeholder = DEFAULT_BODY_PLACEHOLDER;
        dom.articleCoverUrlInput.value = "";
        dom.articleTagsInput.value = "";
        dom.articleCategoryInput.value = "";
        dom.articleAllowCommentsInput.checked = true;
        dom.articleIsPublicInput.checked = true;
        dom.articleEncryptEnabledInput.checked = false;
        dom.articleEncryptPasswordInput.value = "";
        state.loadedEncryptedBody = "";
        state.loadedEncryptedBodyUnlocked = false;
        ui.updateEncryptPanel();
        state.currentCoverFileId = "";
        clearPendingUploads(pendingUploads);
        state.inlineImageCounter = 0;
        updateCoverPreview();
        state.currentItemId = "";
        ui.updateEditorHeader();
        ui.updateUrlState();
        preview.resetPreviewState();
        ui.setSubmitError("");
        ui.setSubmitMessage("");
        ui.setCoverMessage("");
        ui.updateTitleHint();
        markDraftSaved();
    };

    const loadDetail = async (id: string): Promise<void> => {
        const targetId = String(id || "").trim();
        if (!targetId || !state.isLoggedIn) {
            return;
        }
        try {
            const { response, data } = await api(
                `/api/v1/me/articles/${encodeURIComponent(targetId)}`,
                { method: "GET" },
            );
            if (response.status === 401) {
                emitAuthState({
                    isLoggedIn: false,
                    isAdmin: false,
                    userId: "",
                    username: "",
                });
                return;
            }
            if (!response.ok || !data?.ok) {
                ui.setSubmitError(
                    getApiMessage(data, t(I18nKey.articleEditorLoadFailed)),
                );
                return;
            }
            const item = toRecord(data.item);
            if (!item) {
                ui.setSubmitError(
                    t(I18nKey.articleEditorEditableContentNotFound),
                );
                return;
            }
            clearPendingUploads(pendingUploads);
            state.inlineImageCounter = 0;
            const unlockedEncryptedBody = await fillForm(item);
            state.currentItemId = toStringValue(item.id) || targetId;
            const loadedShortId = toStringValue(item.short_id);
            if (loadedShortId) {
                state.currentItemShortId = loadedShortId;
            }
            ui.updateEditorHeader();
            ui.updateUrlState();
            preview.resetPreviewState();
            ui.setSubmitError("");
            ui.setSubmitMessage(
                state.loadedEncryptedBody
                    ? unlockedEncryptedBody
                        ? t(I18nKey.articleEditorEncryptedAutoUnlocked)
                        : t(
                              I18nKey.articleEditorEncryptedAutoUnlockMissingPassword,
                          )
                    : "",
            );
            preview.markPreviewDirty();
            markDraftSaved();
        } catch (error) {
            console.error("[publish] load detail failed:", error);
            ui.setSubmitError(t(I18nKey.articleEditorLoadFailedRetry));
        }
    };

    const ctx: PageContext = {
        dom,
        editor,
        state,
        pendingUploads,
        saveOverlay,
        previewClient,
        ui,
        preview,
        cropModal,
        clientShortId,
        updateCoverPreview,
        fillForm,
        resetForm,
        loadDetail,
    };

    ui.updateEditorHeader();
    ui.updateUrlState();
    preview.renderPreview();
    ui.updateTitleHint();
    ui.updateEncryptPanel();
    markDraftSaved();

    const pageController = new AbortController();
    activePublishPageController = pageController;
    const disposeUnsavedGuard = setupUnsavedChangesGuard({
        isDirty: hasUnsavedDraftChanges,
        getConfirmMessage: () =>
            t(I18nKey.interactionCommonUnsavedChangesLeaveConfirm),
    });
    let disposed = false;
    const disposePublishResources = (): void => {
        if (disposed) {
            return;
        }
        disposed = true;
        if (disposeActivePublishPage === disposePublishResources) {
            disposeActivePublishPage = null;
        }
        if (activePublishPageController === pageController) {
            activePublishPageController = null;
        }
        pageController.abort();
        disposeUnsavedGuard();
        editor.dispose();
        clearPendingUploads(pendingUploads);
        cropModal.destroy();
        saveOverlay.destroy();
    };
    disposeActivePublishPage = disposePublishResources;

    bindEditorEvents(ctx);
    bindScrollSync(editor, dom.previewScrollEl);
    bindCoverEvents(ctx);
    bindSubmitAndAuth(ctx, initialIdFromUrl);
    bindSettingsOverlay();

    document.addEventListener("astro:before-swap", disposePublishResources, {
        once: true,
        signal: pageController.signal,
    });
    window.addEventListener("pagehide", disposePublishResources, {
        once: true,
        signal: pageController.signal,
    });
}

export function initPublishPage(): void {
    void initPublishPageCore();
}
