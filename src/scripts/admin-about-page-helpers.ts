import I18nKey from "@/i18n/i18nKey";
import { setupCodeCopyDelegation } from "@/scripts/code-copy";
import { refreshGithubCards } from "@/scripts/github-card-runtime";
import { t } from "@/scripts/i18n-runtime";
import {
    type MarkdownPreviewClient,
    normalizeMarkdownPreviewHtml,
} from "@/scripts/markdown-preview-client";

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

export function applyWrapAction(
    textarea: HTMLTextAreaElement,
    prefix: string,
    suffix: string,
    placeholder: string,
    onDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const content = selected || placeholder;
    const replacement = `${prefix}${content}${suffix}`;
    replaceSelection(
        textarea,
        replacement,
        prefix.length,
        prefix.length + content.length,
        onDirty,
    );
}

export function applyQuoteAction(
    textarea: HTMLTextAreaElement,
    onDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const source = selected || t(I18nKey.adminMarkdownQuotePlaceholder);
    const quoted = source
        .replaceAll("\r\n", "\n")
        .split("\n")
        .map((line) => (line.startsWith("> ") ? line : `> ${line}`))
        .join("\n");
    replaceSelection(textarea, quoted, 0, quoted.length, onDirty);
}

export function applyCodeBlockAction(
    textarea: HTMLTextAreaElement,
    onDirty: () => void,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const source = textarea.value;
    const selected =
        source.slice(start, end) || t(I18nKey.adminMarkdownCodePlaceholder);
    const language = "text";
    const block = `\`\`\`${language}\n${selected}\n\`\`\``;
    const needsLeadingBreak = start > 0 && source[start - 1] !== "\n";
    const needsTrailingBreak = end < source.length && source[end] !== "\n";
    const replacement = `${needsLeadingBreak ? "\n" : ""}${block}${needsTrailingBreak ? "\n" : ""}`;
    const contentStartOffset = (needsLeadingBreak ? 1 : 0) + 8;
    const contentEndOffset = contentStartOffset + selected.length;
    replaceSelection(
        textarea,
        replacement,
        contentStartOffset,
        contentEndOffset,
        onDirty,
    );
}

export function applyToolbarAction(
    action: ToolbarAction,
    bodyEl: HTMLTextAreaElement,
    onDirty: () => void,
): void {
    if (action === "bold") {
        applyWrapAction(
            bodyEl,
            "**",
            "**",
            t(I18nKey.adminMarkdownBoldPlaceholder),
            onDirty,
        );
        return;
    }
    if (action === "italic") {
        applyWrapAction(
            bodyEl,
            "*",
            "*",
            t(I18nKey.adminMarkdownItalicPlaceholder),
            onDirty,
        );
        return;
    }
    if (action === "underline") {
        applyWrapAction(
            bodyEl,
            "<u>",
            "</u>",
            t(I18nKey.adminMarkdownUnderlinePlaceholder),
            onDirty,
        );
        return;
    }
    if (action === "strike") {
        applyWrapAction(
            bodyEl,
            "~~",
            "~~",
            t(I18nKey.adminMarkdownStrikePlaceholder),
            onDirty,
        );
        return;
    }
    if (action === "quote") {
        applyQuoteAction(bodyEl, onDirty);
        return;
    }
    if (action === "inline-code") {
        applyWrapAction(
            bodyEl,
            "`",
            "`",
            t(I18nKey.adminMarkdownCodePlaceholder),
            onDirty,
        );
        return;
    }
    applyCodeBlockAction(bodyEl, onDirty);
}

export function makeSetMsg(saveMsgEl: HTMLElement): (message: string) => void {
    return (message: string): void => {
        saveMsgEl.textContent = message;
    };
}

export function makeSetError(
    saveErrorEl: HTMLElement,
): (message: string) => void {
    return (message: string): void => {
        if (!message) {
            saveErrorEl.textContent = "";
            saveErrorEl.classList.add("hidden");
            return;
        }
        saveErrorEl.textContent = message;
        saveErrorEl.classList.remove("hidden");
    };
}

export function makeRefreshMarkdownRuntime(
    runtimeWindow: RuntimeWindow,
    logPrefix: string,
): () => Promise<void> {
    return async (): Promise<void> => {
        setupCodeCopyDelegation();
        try {
            await refreshGithubCards();
        } catch (error) {
            console.warn(`${logPrefix} refresh github cards failed:`, error);
        }
        if (typeof runtimeWindow.renderMermaidDiagrams === "function") {
            void runtimeWindow.renderMermaidDiagrams().catch((error) => {
                console.warn(`${logPrefix} refresh mermaid failed:`, error);
            });
        }
    };
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

export type PreviewState = {
    loading: boolean;
    error: string;
    html: string;
    source: string;
    dirty: boolean;
    generation: number;
    fastTimer: number | null;
    fullTimer: number | null;
    renderedHtml: string;
};

export async function handlePreviewResult(
    result: Awaited<ReturnType<MarkdownPreviewClient["preview"]>>,
    source: string,
    mode: "fast" | "full",
    state: PreviewState,
): Promise<void> {
    if (result.aborted) {
        return;
    }
    if (result.error) {
        state.html = "";
        state.error = result.error;
        state.dirty = true;
        return;
    }
    state.source = source;
    state.html = normalizeMarkdownPreviewHtml(result.html);
    state.error = "";
    if (mode === "full") {
        state.dirty = false;
    }
}

export type PreviewRenderElements = {
    previewLoadingEl: HTMLElement;
    previewErrorEl: HTMLElement;
    previewContentEl: HTMLElement;
    previewEmptyEl: HTMLElement;
};

export function makeRenderPreview(
    els: PreviewRenderElements,
    state: PreviewState,
    refreshMarkdownRuntime: () => Promise<void>,
): () => void {
    return (): void => {
        els.previewLoadingEl.classList.toggle("hidden", !state.loading);
        if (state.error) {
            els.previewErrorEl.textContent = state.error;
            els.previewErrorEl.classList.remove("hidden");
        } else {
            els.previewErrorEl.textContent = "";
            els.previewErrorEl.classList.add("hidden");
        }
        if (state.html) {
            if (state.renderedHtml !== state.html) {
                els.previewContentEl.innerHTML = state.html;
                state.renderedHtml = state.html;
                void refreshMarkdownRuntime();
            }
            els.previewContentEl.classList.remove("hidden");
            els.previewEmptyEl.classList.add("hidden");
            return;
        }
        els.previewContentEl.innerHTML = "";
        state.renderedHtml = "";
        els.previewContentEl.classList.add("hidden");
        els.previewEmptyEl.classList.remove("hidden");
    };
}
