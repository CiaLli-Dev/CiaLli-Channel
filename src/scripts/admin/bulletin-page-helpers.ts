import I18nKey from "@/i18n/i18nKey";
import { setupCodeCopyDelegation } from "@/scripts/markdown/code-copy";
import { refreshGithubCards } from "@/scripts/markdown/github-card-runtime";
import { t } from "@/scripts/shared/i18n-runtime";
import type { MarkdownPreviewClient } from "@/scripts/markdown/preview-client";
import { normalizeMarkdownPreviewHtml } from "@/scripts/markdown/preview-client";
import type { MarkdownImagePasteUploader } from "@/scripts/markdown/image-paste";
import {
    getApiErrorMessage,
    requestApi as api,
} from "@/scripts/shared/http-client";
import type { PublishEditorAdapter } from "@/scripts/publish/editor-adapter";

export type EditorMode = "edit" | "preview";
export type ToolbarAction =
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "quote"
    | "inline-code"
    | "code-block";

export type RuntimeWindow = Window &
    typeof globalThis & {
        renderMermaidDiagrams?: () => Promise<void>;
    };

export const TOOLBAR_ACTIONS = new Set<ToolbarAction>([
    "bold",
    "italic",
    "underline",
    "strike",
    "quote",
    "inline-code",
    "code-block",
]);

export function isToolbarAction(value: string): value is ToolbarAction {
    return TOOLBAR_ACTIONS.has(value as ToolbarAction);
}

export function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function toStringValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    return "";
}

// ===== DOM element bundle =====

export type BulletinElements = {
    formEl: HTMLFormElement;
    titleEl: HTMLInputElement;
    summaryEl: HTMLTextAreaElement;
    closableEl: HTMLInputElement;
    bodyEl: HTMLTextAreaElement;
    monacoHostEl: HTMLElement;
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

function getEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

export function getBulletinElements(
    formEl: HTMLFormElement,
): BulletinElements | null {
    const titleEl = getEl<HTMLInputElement>("bulletin-title");
    const summaryEl = getEl<HTMLTextAreaElement>("bulletin-summary");
    const closableEl = getEl<HTMLInputElement>("bulletin-closable");
    const bodyEl = getEl<HTMLTextAreaElement>("bulletin-body-markdown");
    const monacoHostEl = getEl("bulletin-editor-monaco");
    const modeEditEl = getEl<HTMLButtonElement>("bulletin-mode-edit");
    const modePreviewEl = getEl<HTMLButtonElement>("bulletin-mode-preview");
    const editorPanelEl = getEl("bulletin-editor-panel");
    const toolbarEl = getEl("bulletin-toolbar");
    const saveMsgEl = getEl("bulletin-save-msg");
    const saveErrorEl = getEl("bulletin-save-error");
    const saveBtnEl = getEl<HTMLButtonElement>("bulletin-save");
    const previewPanelEl = getEl("bulletin-preview-panel");
    const previewLoadingEl = getEl("bulletin-preview-loading");
    const previewErrorEl = getEl("bulletin-preview-error");
    const previewEmptyEl = getEl("bulletin-preview-empty");
    const previewContentEl = getEl("bulletin-preview-content");

    const requiredGroup1 = [
        titleEl,
        summaryEl,
        closableEl,
        bodyEl,
        monacoHostEl,
        modeEditEl,
        modePreviewEl,
        editorPanelEl,
        toolbarEl,
    ];
    const requiredGroup2 = [
        saveMsgEl,
        saveErrorEl,
        saveBtnEl,
        previewPanelEl,
        previewLoadingEl,
        previewErrorEl,
        previewEmptyEl,
        previewContentEl,
    ];
    if (requiredGroup1.some((el) => !el) || requiredGroup2.some((el) => !el)) {
        return null;
    }

    return {
        formEl,
        titleEl: titleEl as HTMLInputElement,
        summaryEl: summaryEl as HTMLTextAreaElement,
        closableEl: closableEl as HTMLInputElement,
        bodyEl: bodyEl as HTMLTextAreaElement,
        monacoHostEl: monacoHostEl as HTMLElement,
        modeEditEl: modeEditEl as HTMLButtonElement,
        modePreviewEl: modePreviewEl as HTMLButtonElement,
        editorPanelEl: editorPanelEl as HTMLElement,
        toolbarEl: toolbarEl as HTMLElement,
        saveMsgEl: saveMsgEl as HTMLElement,
        saveErrorEl: saveErrorEl as HTMLElement,
        saveBtnEl: saveBtnEl as HTMLButtonElement,
        previewPanelEl: previewPanelEl as HTMLElement,
        previewLoadingEl: previewLoadingEl as HTMLElement,
        previewErrorEl: previewErrorEl as HTMLElement,
        previewEmptyEl: previewEmptyEl as HTMLElement,
        previewContentEl: previewContentEl as HTMLElement,
    };
}

// ===== Preview state =====

export type PreviewState = {
    currentMode: EditorMode;
    previewLoading: boolean;
    previewError: string;
    previewHtml: string;
    previewSource: string;
    previewDirty: boolean;
    previewGeneration: number;
    previewFastTimer: number | null;
    previewFullTimer: number | null;
    renderedPreviewHtml: string;
};

export function createPreviewState(): PreviewState {
    return {
        currentMode: "edit",
        previewLoading: false,
        previewError: "",
        previewHtml: "",
        previewSource: "",
        previewDirty: false,
        previewGeneration: 0,
        previewFastTimer: null,
        previewFullTimer: null,
        renderedPreviewHtml: "",
    };
}

// ===== UI helpers =====

export function setBulletinMsg(saveMsgEl: HTMLElement, message: string): void {
    saveMsgEl.textContent = message;
}

export function setBulletinError(
    saveErrorEl: HTMLElement,
    message: string,
): void {
    if (!message) {
        saveErrorEl.textContent = "";
        saveErrorEl.classList.add("hidden");
        return;
    }
    saveErrorEl.textContent = message;
    saveErrorEl.classList.remove("hidden");
}

export function updateModeButtonStyle(
    button: HTMLButtonElement,
    active: boolean,
): void {
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.classList.toggle("text-90", active);
    button.classList.toggle("text-60", !active);
    button.classList.toggle("bg-(--btn-plain-bg-hover)", active);
    button.classList.toggle("border-(--primary)", active);
}

// ===== Markdown toolbar actions =====

export function replaceSelection(
    textarea: HTMLTextAreaElement,
    replacement: string,
    selectionStartOffset: number,
    selectionEndOffset: number,
    onDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const source = textarea.value;
    const before = source.slice(0, start);
    const after = source.slice(end);
    textarea.value = `${before}${replacement}${after}`;
    const nextStart = before.length + selectionStartOffset;
    const nextEnd = before.length + selectionEndOffset;
    textarea.focus();
    textarea.setSelectionRange(nextStart, nextEnd);
    onDirty();
}

export function applyToolbarAction(
    action: ToolbarAction,
    editor: PublishEditorAdapter,
    onDirty: () => void,
): void {
    const applyWrap = (
        prefix: string,
        suffix: string,
        placeholder: string,
    ): void => {
        const { start, end } = editor.getSelection();
        const value = editor.getValue();
        const selected = value.slice(start, end);
        const content = selected || placeholder;
        const replacement = `${prefix}${content}${suffix}`;
        editor.replaceSelection(
            replacement,
            prefix.length,
            prefix.length + content.length,
        );
        onDirty();
    };

    if (action === "bold") {
        applyWrap("**", "**", t(I18nKey.adminMarkdownBoldPlaceholder));
        return;
    }
    if (action === "italic") {
        applyWrap("*", "*", t(I18nKey.adminMarkdownItalicPlaceholder));
        return;
    }
    if (action === "underline") {
        applyWrap("<u>", "</u>", t(I18nKey.adminMarkdownUnderlinePlaceholder));
        return;
    }
    if (action === "strike") {
        applyWrap("~~", "~~", t(I18nKey.adminMarkdownStrikePlaceholder));
        return;
    }
    if (action === "quote") {
        const { start, end } = editor.getSelection();
        const value = editor.getValue();
        const selected = value.slice(start, end);
        const source = selected || t(I18nKey.adminMarkdownQuotePlaceholder);
        const quoted = source
            .replaceAll("\r\n", "\n")
            .split("\n")
            .map((line) => (line.startsWith("> ") ? line : `> ${line}`))
            .join("\n");
        editor.replaceSelection(quoted, 0, quoted.length);
        onDirty();
        return;
    }
    if (action === "inline-code") {
        applyWrap("`", "`", t(I18nKey.adminMarkdownCodePlaceholder));
        return;
    }
    // code-block
    {
        const { start, end } = editor.getSelection();
        const value = editor.getValue();
        const selected =
            value.slice(start, end) || t(I18nKey.adminMarkdownCodePlaceholder);
        const language = "text";
        const block = `\`\`\`${language}\n${selected}\n\`\`\``;
        const needsLeadingBreak = start > 0 && value[start - 1] !== "\n";
        const needsTrailingBreak = end < value.length && value[end] !== "\n";
        const replacement = `${needsLeadingBreak ? "\n" : ""}${block}${needsTrailingBreak ? "\n" : ""}`;
        const contentStartOffset = (needsLeadingBreak ? 1 : 0) + 8;
        const contentEndOffset = contentStartOffset + selected.length;
        editor.replaceSelection(
            replacement,
            contentStartOffset,
            contentEndOffset,
        );
        onDirty();
    }
}

// ===== Preview rendering =====

export async function refreshMarkdownRuntime(
    runtimeWindow: RuntimeWindow,
): Promise<void> {
    setupCodeCopyDelegation();
    try {
        await refreshGithubCards();
    } catch (error) {
        console.warn("[admin-bulletin] refresh github cards failed:", error);
    }
    if (typeof runtimeWindow.renderMermaidDiagrams === "function") {
        void runtimeWindow.renderMermaidDiagrams().catch((error) => {
            console.warn("[admin-bulletin] refresh mermaid failed:", error);
        });
    }
}

type PreviewPanelElements = Pick<
    BulletinElements,
    | "previewLoadingEl"
    | "previewErrorEl"
    | "previewContentEl"
    | "previewEmptyEl"
>;

export function renderPreviewPanel(
    panelEls: PreviewPanelElements,
    state: PreviewState,
    runtimeWindow: RuntimeWindow,
): void {
    panelEls.previewLoadingEl.classList.toggle("hidden", !state.previewLoading);

    if (state.previewError) {
        panelEls.previewErrorEl.textContent = state.previewError;
        panelEls.previewErrorEl.classList.remove("hidden");
    } else {
        panelEls.previewErrorEl.textContent = "";
        panelEls.previewErrorEl.classList.add("hidden");
    }

    if (state.previewHtml) {
        if (state.renderedPreviewHtml !== state.previewHtml) {
            panelEls.previewContentEl.innerHTML = state.previewHtml;
            state.renderedPreviewHtml = state.previewHtml;
            void refreshMarkdownRuntime(runtimeWindow);
        }
        panelEls.previewContentEl.classList.remove("hidden");
        panelEls.previewEmptyEl.classList.add("hidden");
        return;
    }

    panelEls.previewContentEl.innerHTML = "";
    state.renderedPreviewHtml = "";
    panelEls.previewContentEl.classList.add("hidden");
    panelEls.previewEmptyEl.classList.remove("hidden");
}

// ===== Preview request helpers =====

function applyPreviewSuccess(
    state: PreviewState,
    source: string,
    html: string,
    mode: "fast" | "full",
): void {
    state.previewSource = source;
    state.previewHtml = normalizeMarkdownPreviewHtml(html);
    state.previewError = "";
    if (mode === "full") {
        state.previewDirty = false;
    }
}

function applyPreviewError(state: PreviewState, errorMsg: string): void {
    state.previewHtml = "";
    state.previewError = errorMsg;
    state.previewDirty = true;
}

function shouldSkipFastPreview(
    state: PreviewState,
    source: string,
    mode: "fast" | "full",
    force: boolean,
): boolean {
    return (
        !force &&
        mode === "fast" &&
        !state.previewDirty &&
        source === state.previewSource
    );
}

function applyIncrementalFastPreview(
    state: PreviewState,
    source: string,
    mode: "fast" | "full",
    previewClient: MarkdownPreviewClient,
): void {
    if (mode !== "fast") return;
    const incrementalHtml = previewClient.getIncrementalPreview(source);
    if (incrementalHtml) {
        state.previewHtml = incrementalHtml;
    }
}

export async function requestPreview(
    mode: "fast" | "full",
    generation: number,
    state: PreviewState,
    editor: PublishEditorAdapter,
    previewClient: MarkdownPreviewClient,
    renderPreview: () => void,
    force = false,
): Promise<void> {
    if (generation !== state.previewGeneration) {
        return;
    }
    const source = editor.getValue();
    const markdown = source.trim();
    if (shouldSkipFastPreview(state, source, mode, force)) {
        return;
    }

    if (!markdown) {
        state.previewSource = source;
        state.previewHtml = "";
        state.previewError = "";
        state.previewLoading = false;
        state.previewDirty = false;
        renderPreview();
        return;
    }

    state.previewLoading = true;
    state.previewError = "";
    applyIncrementalFastPreview(state, source, mode, previewClient);
    renderPreview();

    try {
        const result = await previewClient.preview(markdown, { force, mode });
        if (generation !== state.previewGeneration || result.aborted) {
            return;
        }
        if (result.error) {
            applyPreviewError(state, result.error);
            return;
        }
        applyPreviewSuccess(state, source, result.html, mode);
    } catch (error) {
        console.error("[admin-bulletin] preview failed:", error);
        if (generation !== state.previewGeneration) {
            return;
        }
        applyPreviewError(state, t(I18nKey.adminMarkdownPreviewFailedRetry));
    } finally {
        if (generation === state.previewGeneration) {
            state.previewLoading = false;
            renderPreview();
        }
    }
}

// ===== Save task helper =====

export type SaveTaskUpdate = (options: { text: string }) => void;

export async function executeSaveTask(
    els: BulletinElements,
    imagePasteUploader: MarkdownImagePasteUploader,
    fillForm: (data: Record<string, unknown> | null) => void,
    update: SaveTaskUpdate,
): Promise<void> {
    const uploadsReady = await imagePasteUploader.flushPendingUploads();
    if (!uploadsReady) {
        setBulletinMsg(els.saveMsgEl, "");
        setBulletinError(
            els.saveErrorEl,
            t(I18nKey.interactionCommonImageUploadFailedRetry),
        );
        return;
    }

    const bodyMarkdown = String(els.bodyEl.value || "").trim();
    if (!bodyMarkdown) {
        setBulletinError(els.saveErrorEl, t(I18nKey.adminBulletinBodyRequired));
        return;
    }

    update({ text: t(I18nKey.adminBulletinSavingText) });
    const payload = {
        title: String(els.titleEl.value || "").trim(),
        summary: String(els.summaryEl.value || "").trim(),
        body_markdown: bodyMarkdown,
        closable: Boolean(els.closableEl.checked),
    };
    const { response, data } = await api("/api/v1/admin/settings/bulletin", {
        method: "PATCH",
        body: JSON.stringify(payload),
    });
    if (!response.ok || !data?.ok) {
        setBulletinMsg(els.saveMsgEl, "");
        setBulletinError(
            els.saveErrorEl,
            getApiErrorMessage(data, t(I18nKey.interactionCommonSaveFailed)),
        );
        return;
    }
    update({ text: t(I18nKey.interactionCommonSaveCompleted) });
    fillForm(toRecord(data.announcement));
    setBulletinMsg(els.saveMsgEl, t(I18nKey.interactionCommonSaveSuccess));
}
