import { t } from "@/scripts/shared/i18n-runtime";
import I18nKey from "@/i18n/i18nKey";
import { MarkdownImagePasteUploader } from "@/scripts/markdown/image-paste";
import { MarkdownPreviewClient } from "@/scripts/markdown/preview-client";
import { runWithTask } from "@/scripts/shared/progress-overlay-manager";
import {
    getApiErrorMessage,
    requestApi as api,
} from "@/scripts/shared/http-client";
import { createPublishEditorAdapter } from "@/scripts/publish/editor-monaco";
import type { PublishEditorAdapter } from "@/scripts/publish/editor-adapter";
import {
    toRecord,
    toStringValue,
    isToolbarAction,
    getBulletinElements,
    createPreviewState,
    setBulletinMsg,
    setBulletinError,
    updateModeButtonStyle,
    applyToolbarAction,
    renderPreviewPanel,
    requestPreview,
    executeSaveTask,
    type RuntimeWindow,
    type EditorMode,
    type BulletinElements,
    type PreviewState,
} from "@/scripts/admin/bulletin-page-helpers";

const DATA_BOUND = "data-admin-bulletin-bound";

function makeRenderPreview(
    els: BulletinElements,
    state: PreviewState,
    runtimeWindow: RuntimeWindow,
): () => void {
    return () =>
        renderPreviewPanel(
            {
                previewLoadingEl: els.previewLoadingEl,
                previewErrorEl: els.previewErrorEl,
                previewContentEl: els.previewContentEl,
                previewEmptyEl: els.previewEmptyEl,
            },
            state,
            runtimeWindow,
        );
}

function makeSchedulePreview(
    state: PreviewState,
    editor: PublishEditorAdapter,
    previewClient: MarkdownPreviewClient,
    renderPreview: () => void,
): () => void {
    return () => {
        if (state.currentMode !== "preview" || !state.previewDirty) return;
        if (state.previewFastTimer !== null)
            window.clearTimeout(state.previewFastTimer);
        if (state.previewFullTimer !== null)
            window.clearTimeout(state.previewFullTimer);
        const gen = state.previewGeneration;
        state.previewFastTimer = window.setTimeout(() => {
            state.previewFastTimer = null;
            void requestPreview(
                "fast",
                gen,
                state,
                editor,
                previewClient,
                renderPreview,
            );
        }, previewClient.getFastDebounceDelay());
        state.previewFullTimer = window.setTimeout(() => {
            state.previewFullTimer = null;
            void requestPreview(
                "full",
                gen,
                state,
                editor,
                previewClient,
                renderPreview,
            );
        }, previewClient.getFullDebounceDelay());
    };
}

function setupEditorModeButtons(
    els: BulletinElements,
    state: PreviewState,
    schedulePreview: () => void,
): void {
    const setEditorMode = (mode: EditorMode): void => {
        state.currentMode = mode;
        els.editorPanelEl.classList.toggle("hidden", mode !== "edit");
        els.previewPanelEl.classList.toggle("hidden", mode !== "preview");
        updateModeButtonStyle(els.modeEditEl, mode === "edit");
        updateModeButtonStyle(els.modePreviewEl, mode === "preview");
        if (mode === "preview") schedulePreview();
    };

    els.modeEditEl.addEventListener("click", () => setEditorMode("edit"));
    els.modePreviewEl.addEventListener("click", () => setEditorMode("preview"));
    setEditorMode("edit");
}

function setupBodyListeners(
    els: BulletinElements,
    state: PreviewState,
    editor: PublishEditorAdapter,
    previewClient: MarkdownPreviewClient,
    renderPreview: () => void,
    markPreviewDirty: () => void,
    schedulePreview: () => void,
    imagePasteUploader: MarkdownImagePasteUploader,
): void {
    editor.onInput(() => {
        markPreviewDirty();
        schedulePreview();
    });
    editor.onPaste((event) => {
        // MarkdownImagePasteUploader 仍基于 textarea 选区插入内容，先同步 Monaco 选区避免插入位置偏移。
        const selection = editor.getSelection();
        els.bodyEl.setSelectionRange(selection.start, selection.end);
        imagePasteUploader.handlePaste(event);
    });
    editor.onBlur(() => {
        if (!state.previewDirty) return;
        if (state.previewFastTimer !== null) {
            window.clearTimeout(state.previewFastTimer);
            state.previewFastTimer = null;
        }
        if (state.previewFullTimer !== null) {
            window.clearTimeout(state.previewFullTimer);
            state.previewFullTimer = null;
        }
        void requestPreview(
            "full",
            state.previewGeneration,
            state,
            editor,
            previewClient,
            renderPreview,
            true,
        );
    });
    els.toolbarEl.addEventListener("click", (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        const button = target.closest<HTMLButtonElement>("[data-md-action]");
        if (!button) return;
        const action = String(button.dataset.mdAction || "");
        if (!isToolbarAction(action)) return;
        applyToolbarAction(action, editor, markPreviewDirty);
        schedulePreview();
    });
}

export async function initAdminBulletinPage(): Promise<void> {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/admin/bulletin") return;

    const formEl = document.getElementById(
        "bulletin-form",
    ) as HTMLFormElement | null;
    if (!formEl || formEl.hasAttribute(DATA_BOUND)) return;
    formEl.setAttribute(DATA_BOUND, "1");

    const els = getBulletinElements(formEl);
    if (!els) return;

    const editor: PublishEditorAdapter = await createPublishEditorAdapter({
        textareaEl: els.bodyEl,
        monacoHostEl: els.monacoHostEl,
    });

    const runtimeWindow = window as RuntimeWindow;
    const previewClient = new MarkdownPreviewClient("bulletin");
    const state = createPreviewState();
    const renderPreview = makeRenderPreview(els, state, runtimeWindow);
    const markPreviewDirty = (): void => {
        state.previewDirty = true;
        state.previewGeneration += 1;
    };
    const schedulePreview = makeSchedulePreview(
        state,
        editor,
        previewClient,
        renderPreview,
    );

    const fillForm = (announcement: Record<string, unknown> | null): void => {
        els.titleEl.value = toStringValue(announcement?.title);
        els.summaryEl.value = toStringValue(announcement?.summary);
        editor.setValue(toStringValue(announcement?.body_markdown));
        els.closableEl.checked = Boolean(announcement?.closable);
        state.previewHtml = "";
        state.previewError = "";
        state.previewLoading = false;
        state.previewDirty = true;
        state.previewSource = editor.getValue();
        state.previewGeneration += 1;
        previewClient.resetIncrementalState();
        if (state.previewFastTimer !== null) {
            window.clearTimeout(state.previewFastTimer);
            state.previewFastTimer = null;
        }
        if (state.previewFullTimer !== null) {
            window.clearTimeout(state.previewFullTimer);
            state.previewFullTimer = null;
        }
        renderPreview();
    };

    const imagePasteUploader = new MarkdownImagePasteUploader({
        textarea: els.bodyEl,
        fileNamePrefix: "bulletin",
        autoUpload: false,
        buildUploadTitle: ({ sequence }) =>
            `About-${String(sequence).padStart(2, "0")}`,
        onContentChange: () => {
            // 图片粘贴/上传完成后，将 textarea 的变更同步回 Monaco
            const textareaValue = els.bodyEl.value;
            if (textareaValue !== editor.getValue()) {
                editor.setValue(textareaValue);
            }
            markPreviewDirty();
            schedulePreview();
        },
        onError: (message) => {
            setBulletinMsg(els.saveMsgEl, "");
            setBulletinError(els.saveErrorEl, message);
        },
    });

    const loadBulletin = async (): Promise<void> => {
        setBulletinError(els.saveErrorEl, "");
        setBulletinMsg(els.saveMsgEl, t(I18nKey.interactionCommonLoading));
        try {
            const { response, data } = await api(
                "/api/v1/admin/settings/bulletin",
            );
            if (!response.ok || !data?.ok) {
                setBulletinMsg(els.saveMsgEl, "");
                setBulletinError(
                    els.saveErrorEl,
                    getApiErrorMessage(
                        data,
                        t(I18nKey.adminBulletinLoadFailed),
                    ),
                );
                return;
            }
            fillForm(toRecord(data.announcement));
            setBulletinMsg(els.saveMsgEl, t(I18nKey.interactionCommonLoaded));
            window.setTimeout(() => {
                if (
                    els.saveMsgEl.textContent ===
                    t(I18nKey.interactionCommonLoaded)
                ) {
                    setBulletinMsg(els.saveMsgEl, "");
                }
            }, 1200);
        } catch (error) {
            console.error("[admin-bulletin] load failed:", error);
            setBulletinMsg(els.saveMsgEl, "");
            setBulletinError(
                els.saveErrorEl,
                t(I18nKey.adminBulletinLoadFailedRetry),
            );
        }
    };

    const saveBulletin = async (): Promise<void> => {
        setBulletinError(els.saveErrorEl, "");
        setBulletinMsg(els.saveMsgEl, t(I18nKey.interactionCommonSaving));
        els.saveBtnEl.disabled = true;
        await runWithTask(
            {
                title: t(I18nKey.adminBulletinSavingTitle),
                mode: "indeterminate",
                text: imagePasteUploader.hasPendingUploads()
                    ? t(I18nKey.interactionCommonImageUploading)
                    : t(I18nKey.interactionCommonSaving),
            },
            async ({ update }) => {
                try {
                    await executeSaveTask(
                        els,
                        imagePasteUploader,
                        fillForm,
                        update,
                    );
                } catch (error) {
                    console.error("[admin-bulletin] save failed:", error);
                    setBulletinMsg(els.saveMsgEl, "");
                    setBulletinError(
                        els.saveErrorEl,
                        t(I18nKey.interactionCommonSaveFailedRetry),
                    );
                } finally {
                    els.saveBtnEl.disabled = false;
                }
            },
        );
    };

    setupEditorModeButtons(els, state, schedulePreview);
    setupBodyListeners(
        els,
        state,
        editor,
        previewClient,
        renderPreview,
        markPreviewDirty,
        schedulePreview,
        imagePasteUploader,
    );

    els.formEl.addEventListener("submit", (event: Event) => {
        event.preventDefault();
        void saveBulletin();
    });
    window.addEventListener("beforeunload", () => {
        imagePasteUploader.dispose();
        editor.dispose();
    });

    void loadBulletin();
}
