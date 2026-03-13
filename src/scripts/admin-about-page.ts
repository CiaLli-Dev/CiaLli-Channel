/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
import I18nKey from "@/i18n/i18nKey";
import { MarkdownImagePasteUploader } from "@/scripts/markdown-image-paste";
import { MarkdownPreviewClient } from "@/scripts/markdown-preview-client";
import { runWithTask } from "@/scripts/progress-overlay-manager";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";
import {
    type EditorMode,
    type RuntimeWindow,
    type PreviewState,
    isToolbarAction,
    toRecord,
    toStringValue,
    applyToolbarAction,
    makeSetMsg,
    makeSetError,
    makeRefreshMarkdownRuntime,
    updateModeButtonStyle,
    handlePreviewResult,
    makeRenderPreview,
} from "@/scripts/admin-about-page-helpers";
import { t } from "@/scripts/i18n-runtime";

const DATA_BOUND = "data-admin-about-bound";

type AboutPageElements = {
    formEl: HTMLFormElement;
    titleEl: HTMLInputElement;
    summaryEl: HTMLTextAreaElement;
    bodyEl: HTMLTextAreaElement;
    modeEditEl: HTMLButtonElement;
    modePreviewEl: HTMLButtonElement;
    editorPanelEl: HTMLElement;
    toolbarEl: HTMLElement;
    saveMsgEl: HTMLElement;
    saveErrorEl: HTMLElement;
    saveBtnEl: HTMLButtonElement;
    previewPanelEl: HTMLElement;
    previewLoadingEl: HTMLElement;
    previewErrorEl: HTMLElement;
    previewEmptyEl: HTMLElement;
    previewContentEl: HTMLElement;
};

type AboutPageContext = {
    els: AboutPageElements;
    state: PreviewState;
    previewClient: MarkdownPreviewClient;
    setMsg: (message: string) => void;
    setError: (message: string) => void;
    renderPreview: () => void;
    requestPreview: (
        mode: "fast" | "full",
        generation: number,
        force?: boolean,
    ) => Promise<void>;
    fillForm: (data: Record<string, unknown> | null) => void;
};

function hasRequiredEditorElements(els: {
    titleEl: HTMLElement | null;
    summaryEl: HTMLElement | null;
    bodyEl: HTMLElement | null;
    modeEditEl: HTMLElement | null;
    modePreviewEl: HTMLElement | null;
    editorPanelEl: HTMLElement | null;
    toolbarEl: HTMLElement | null;
    saveMsgEl: HTMLElement | null;
    saveErrorEl: HTMLElement | null;
    saveBtnEl: HTMLElement | null;
}): boolean {
    return Boolean(
        els.titleEl &&
        els.summaryEl &&
        els.bodyEl &&
        els.modeEditEl &&
        els.modePreviewEl &&
        els.editorPanelEl &&
        els.toolbarEl &&
        els.saveMsgEl &&
        els.saveErrorEl &&
        els.saveBtnEl,
    );
}

function hasRequiredPreviewElements(els: {
    previewPanelEl: HTMLElement | null;
    previewLoadingEl: HTMLElement | null;
    previewErrorEl: HTMLElement | null;
    previewEmptyEl: HTMLElement | null;
    previewContentEl: HTMLElement | null;
}): boolean {
    return Boolean(
        els.previewPanelEl &&
        els.previewLoadingEl &&
        els.previewErrorEl &&
        els.previewEmptyEl &&
        els.previewContentEl,
    );
}

function queryAboutPageElements(): AboutPageElements | null {
    const formEl = document.getElementById(
        "about-form",
    ) as HTMLFormElement | null;
    if (!formEl || formEl.hasAttribute(DATA_BOUND)) {
        return null;
    }
    const els = {
        titleEl: document.getElementById(
            "about-title",
        ) as HTMLInputElement | null,
        summaryEl: document.getElementById(
            "about-summary",
        ) as HTMLTextAreaElement | null,
        bodyEl: document.getElementById(
            "about-body-markdown",
        ) as HTMLTextAreaElement | null,
        modeEditEl: document.getElementById(
            "about-mode-edit",
        ) as HTMLButtonElement | null,
        modePreviewEl: document.getElementById(
            "about-mode-preview",
        ) as HTMLButtonElement | null,
        editorPanelEl: document.getElementById("about-editor-panel"),
        toolbarEl: document.getElementById("about-toolbar"),
        saveMsgEl: document.getElementById("about-save-msg"),
        saveErrorEl: document.getElementById("about-save-error"),
        saveBtnEl: document.getElementById(
            "about-save",
        ) as HTMLButtonElement | null,
        previewPanelEl: document.getElementById("about-preview-panel"),
        previewLoadingEl: document.getElementById("about-preview-loading"),
        previewErrorEl: document.getElementById("about-preview-error"),
        previewEmptyEl: document.getElementById("about-preview-empty"),
        previewContentEl: document.getElementById("about-preview-content"),
    };
    if (!hasRequiredEditorElements(els) || !hasRequiredPreviewElements(els)) {
        return null;
    }
    return { formEl, ...els } as AboutPageElements;
}

function setupModeHandlers(
    modeEditEl: HTMLButtonElement,
    modePreviewEl: HTMLButtonElement,
    setEditorMode: (mode: EditorMode) => void,
): void {
    modeEditEl.addEventListener("click", () => {
        setEditorMode("edit");
    });
    modePreviewEl.addEventListener("click", () => {
        setEditorMode("preview");
    });
}

type RequestPreviewFn = (
    mode: "fast" | "full",
    generation: number,
    force?: boolean,
) => Promise<void>;

function setupBodyHandlers(
    bodyEl: HTMLTextAreaElement,
    imagePasteUploader: MarkdownImagePasteUploader,
    markPreviewDirty: () => void,
    schedulePreview: () => void,
    state: PreviewState,
    requestPreview: RequestPreviewFn,
): void {
    bodyEl.addEventListener("input", () => {
        markPreviewDirty();
        schedulePreview();
    });
    bodyEl.addEventListener("paste", (event) => {
        imagePasteUploader.handlePaste(event);
    });
    bodyEl.addEventListener("blur", () => {
        if (!state.dirty) {
            return;
        }
        if (state.fastTimer !== null) {
            window.clearTimeout(state.fastTimer);
            state.fastTimer = null;
        }
        if (state.fullTimer !== null) {
            window.clearTimeout(state.fullTimer);
            state.fullTimer = null;
        }
        void requestPreview("full", state.generation, true);
    });
}

function setupToolbarHandler(
    toolbarEl: HTMLElement,
    bodyEl: HTMLTextAreaElement,
    markPreviewDirty: () => void,
    schedulePreview: () => void,
): void {
    toolbarEl.addEventListener("click", (event: Event) => {
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const button = target.closest<HTMLButtonElement>("[data-md-action]");
        if (!button) {
            return;
        }
        const action = String(button.dataset.mdAction || "");
        if (!isToolbarAction(action)) {
            return;
        }
        applyToolbarAction(action, bodyEl, markPreviewDirty);
        schedulePreview();
    });
}

async function requestPreviewImpl(
    mode: "fast" | "full",
    generation: number,
    force: boolean,
    ctx: Omit<AboutPageContext, "requestPreview" | "fillForm">,
): Promise<void> {
    const { state, els, previewClient, renderPreview } = ctx;
    if (generation !== state.generation) {
        return;
    }
    const source = String(els.bodyEl.value || "");
    const markdown = source.trim();
    if (!force && mode === "fast" && !state.dirty && source === state.source) {
        return;
    }
    if (!markdown) {
        state.source = source;
        state.html = "";
        state.error = "";
        state.loading = false;
        state.dirty = false;
        renderPreview();
        return;
    }
    state.loading = true;
    state.error = "";
    if (mode === "fast") {
        const incrementalHtml = previewClient.getIncrementalPreview(source);
        if (incrementalHtml) {
            state.html = incrementalHtml;
        }
    }
    renderPreview();
    try {
        const result = await previewClient.preview(markdown, { force, mode });
        if (generation !== state.generation) {
            return;
        }
        await handlePreviewResult(result, source, mode, state);
    } catch (error) {
        console.error("[admin-about] preview failed:", error);
        if (generation !== state.generation) {
            return;
        }
        state.html = "";
        state.error = t(I18nKey.adminMarkdownPreviewFailedRetry);
        state.dirty = true;
    } finally {
        if (generation === state.generation) {
            state.loading = false;
            renderPreview();
        }
    }
}

function fillFormImpl(
    about: Record<string, unknown> | null,
    ctx: Omit<AboutPageContext, "requestPreview" | "fillForm">,
): void {
    const { els, state, previewClient, renderPreview } = ctx;
    els.titleEl.value = toStringValue(about?.title);
    els.summaryEl.value = toStringValue(about?.summary);
    els.bodyEl.value = toStringValue(about?.body_markdown);
    state.html = "";
    state.error = "";
    state.loading = false;
    state.dirty = true;
    state.source = els.bodyEl.value;
    state.generation += 1;
    previewClient.resetIncrementalState();
    if (state.fastTimer !== null) {
        window.clearTimeout(state.fastTimer);
        state.fastTimer = null;
    }
    if (state.fullTimer !== null) {
        window.clearTimeout(state.fullTimer);
        state.fullTimer = null;
    }
    renderPreview();
}

async function loadAboutImpl(ctx: AboutPageContext): Promise<void> {
    const { setMsg, setError, fillForm, els } = ctx;
    setError("");
    setMsg(t(I18nKey.interactionCommonLoading));
    try {
        const { response, data } = await api("/api/v1/admin/settings/about");
        if (!response.ok || !data?.ok) {
            setMsg("");
            setError(getApiErrorMessage(data, t(I18nKey.adminAboutLoadFailed)));
            return;
        }
        fillForm(toRecord(data.about));
        setMsg(t(I18nKey.interactionCommonLoaded));
        window.setTimeout(() => {
            if (
                els.saveMsgEl.textContent === t(I18nKey.interactionCommonLoaded)
            ) {
                setMsg("");
            }
        }, 1200);
    } catch (error) {
        console.error("[admin-about] load failed:", error);
        setMsg("");
        setError(t(I18nKey.adminAboutLoadFailedRetry));
    }
}

async function saveAboutImpl(
    ctx: AboutPageContext,
    imagePasteUploader: MarkdownImagePasteUploader,
): Promise<void> {
    const { setMsg, setError, fillForm, els } = ctx;
    setError("");
    setMsg(t(I18nKey.interactionCommonSaving));
    els.saveBtnEl.disabled = true;
    await runWithTask(
        {
            title: t(I18nKey.adminAboutSavingTitle),
            mode: "indeterminate",
            text: imagePasteUploader.hasPendingUploads()
                ? t(I18nKey.interactionCommonImageUploading)
                : t(I18nKey.interactionCommonSaving),
        },
        async ({ update }) => {
            try {
                const uploadsReady =
                    await imagePasteUploader.flushPendingUploads();
                if (!uploadsReady) {
                    setMsg("");
                    setError(
                        t(I18nKey.interactionCommonImageUploadFailedRetry),
                    );
                    return;
                }
                const bodyMarkdown = String(els.bodyEl.value || "").trim();
                if (!bodyMarkdown) {
                    setError(t(I18nKey.adminAboutBodyRequired));
                    return;
                }
                update({ text: t(I18nKey.adminAboutSavingText) });
                const payload = {
                    title: String(els.titleEl.value || "").trim(),
                    summary: String(els.summaryEl.value || "").trim(),
                    body_markdown: bodyMarkdown,
                };
                const { response, data } = await api(
                    "/api/v1/admin/settings/about",
                    { method: "PATCH", body: JSON.stringify(payload) },
                );
                if (!response.ok || !data?.ok) {
                    setMsg("");
                    setError(
                        getApiErrorMessage(
                            data,
                            t(I18nKey.interactionCommonSaveFailed),
                        ),
                    );
                    return;
                }
                update({ text: t(I18nKey.interactionCommonSaveCompleted) });
                fillForm(toRecord(data.about));
                setMsg(t(I18nKey.interactionCommonSaveSuccess));
            } catch (error) {
                console.error("[admin-about] save failed:", error);
                setMsg("");
                setError(t(I18nKey.interactionCommonSaveFailedRetry));
            } finally {
                els.saveBtnEl.disabled = false;
            }
        },
    );
}

export function initAdminAboutPage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/admin/settings/about") {
        return;
    }

    const elements = queryAboutPageElements();
    if (!elements) {
        return;
    }

    elements.formEl.setAttribute(DATA_BOUND, "1");

    const runtimeWindow = window as RuntimeWindow;
    const previewClient = new MarkdownPreviewClient("about");
    let currentMode: EditorMode = "edit";

    const state: PreviewState = {
        loading: false,
        error: "",
        html: "",
        source: "",
        dirty: false,
        generation: 0,
        fastTimer: null,
        fullTimer: null,
        renderedHtml: "",
    };

    const setMsg = makeSetMsg(elements.saveMsgEl);
    const setError = makeSetError(elements.saveErrorEl);
    const refreshMarkdownRuntime = makeRefreshMarkdownRuntime(
        runtimeWindow,
        "[admin-about]",
    );
    const renderPreview = makeRenderPreview(
        {
            previewLoadingEl: elements.previewLoadingEl,
            previewErrorEl: elements.previewErrorEl,
            previewContentEl: elements.previewContentEl,
            previewEmptyEl: elements.previewEmptyEl,
        },
        state,
        refreshMarkdownRuntime,
    );

    const baseCtx = {
        els: elements,
        state,
        previewClient,
        setMsg,
        setError,
        renderPreview,
    };

    const requestPreview: RequestPreviewFn = (
        mode,
        generation,
        force = false,
    ) => requestPreviewImpl(mode, generation, force, baseCtx);

    const fillForm = (data: Record<string, unknown> | null): void =>
        fillFormImpl(data, baseCtx);

    const ctx: AboutPageContext = { ...baseCtx, requestPreview, fillForm };

    const markPreviewDirty = (): void => {
        state.dirty = true;
        state.generation += 1;
    };

    const schedulePreview = (): void => {
        if (currentMode !== "preview" || !state.dirty) {
            return;
        }
        if (state.fastTimer !== null) {
            window.clearTimeout(state.fastTimer);
        }
        if (state.fullTimer !== null) {
            window.clearTimeout(state.fullTimer);
        }
        const generation = state.generation;
        state.fastTimer = window.setTimeout(() => {
            state.fastTimer = null;
            void requestPreview("fast", generation);
        }, previewClient.getFastDebounceDelay());
        state.fullTimer = window.setTimeout(() => {
            state.fullTimer = null;
            void requestPreview("full", generation);
        }, previewClient.getFullDebounceDelay());
    };

    const setEditorMode = (mode: EditorMode): void => {
        currentMode = mode;
        elements.editorPanelEl.classList.toggle("hidden", mode !== "edit");
        elements.previewPanelEl.classList.toggle("hidden", mode !== "preview");
        updateModeButtonStyle(elements.modeEditEl, mode === "edit");
        updateModeButtonStyle(elements.modePreviewEl, mode === "preview");
        if (mode === "preview") {
            schedulePreview();
        }
    };

    const imagePasteUploader = new MarkdownImagePasteUploader({
        textarea: elements.bodyEl,
        fileNamePrefix: "about",
        autoUpload: false,
        onContentChange: () => {
            markPreviewDirty();
            schedulePreview();
        },
        onError: (message) => {
            setMsg("");
            setError(message);
        },
    });

    setupModeHandlers(
        elements.modeEditEl,
        elements.modePreviewEl,
        setEditorMode,
    );
    setupBodyHandlers(
        elements.bodyEl,
        imagePasteUploader,
        markPreviewDirty,
        schedulePreview,
        state,
        requestPreview,
    );
    setupToolbarHandler(
        elements.toolbarEl,
        elements.bodyEl,
        markPreviewDirty,
        schedulePreview,
    );
    elements.formEl.addEventListener("submit", (event: Event) => {
        event.preventDefault();
        void saveAboutImpl(ctx, imagePasteUploader);
    });
    window.addEventListener("beforeunload", () => {
        imagePasteUploader.dispose();
    });

    setEditorMode("edit");
    void loadAboutImpl(ctx);
}
