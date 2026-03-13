/**
 * 发布页面工具栏操作
 *
 * Markdown 编辑器工具栏的各类文本插入/包裹动作。
 * 不依赖 DOM 状态或业务逻辑，可独立测试。
 */

import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import type { PublishEditorAdapter } from "@/scripts/publish-editor-adapter";
import {
    type ToolbarAction,
    TOOLBAR_ACTIONS,
} from "@/scripts/publish-page-helpers";

function isToolbarAction(value: string): value is ToolbarAction {
    return TOOLBAR_ACTIONS.has(value as ToolbarAction);
}

function replaceSelection(
    editor: PublishEditorAdapter,
    replacement: string,
    selectionStartOffset: number,
    selectionEndOffset: number,
    markPreviewDirty: () => void,
): void {
    editor.replaceSelection(
        replacement,
        selectionStartOffset,
        selectionEndOffset,
    );
    markPreviewDirty();
}

function applyWrapAction(
    editor: PublishEditorAdapter,
    prefix: string,
    suffix: string,
    placeholder: string,
    markPreviewDirty: () => void,
): void {
    const { start, end } = editor.getSelection();
    const selected = editor.getValue().slice(start, end);
    const content = selected || placeholder;
    const replacement = `${prefix}${content}${suffix}`;
    replaceSelection(
        editor,
        replacement,
        prefix.length,
        prefix.length + content.length,
        markPreviewDirty,
    );
}

function applyQuoteAction(
    editor: PublishEditorAdapter,
    markPreviewDirty: () => void,
): void {
    const { start, end } = editor.getSelection();
    const selected = editor.getValue().slice(start, end);
    const source = selected || t(I18nKey.articleEditorToolbarQuotePlaceholder);
    const quoted = source
        .replaceAll("\r\n", "\n")
        .split("\n")
        .map((line) => (line.startsWith("> ") ? line : `> ${line}`))
        .join("\n");
    replaceSelection(editor, quoted, 0, quoted.length, markPreviewDirty);
}

function applyCodeBlockAction(
    editor: PublishEditorAdapter,
    markPreviewDirty: () => void,
): void {
    const { start, end } = editor.getSelection();
    const source = editor.getValue();
    const selected =
        source.slice(start, end) ||
        t(I18nKey.articleEditorToolbarCodeBlockPlaceholder);
    const language = "text";
    const block = `\`\`\`${language}\n${selected}\n\`\`\``;
    const needsLeadingBreak = start > 0 && source[start - 1] !== "\n";
    const needsTrailingBreak = end < source.length && source[end] !== "\n";
    const prefix = needsLeadingBreak ? "\n" : "";
    const suffix = needsTrailingBreak ? "\n" : "";
    const replacement = `${prefix}${block}${suffix}`;
    const contentStart = prefix.length + `\`\`\`${language}\n`.length;
    const contentEnd = contentStart + selected.length;
    replaceSelection(
        editor,
        replacement,
        contentStart,
        contentEnd,
        markPreviewDirty,
    );
}

export function applyToolbarAction(
    action: string,
    editor: PublishEditorAdapter,
    markPreviewDirty: () => void,
): void {
    if (!isToolbarAction(action)) {
        return;
    }
    if (action === "bold") {
        applyWrapAction(
            editor,
            "**",
            "**",
            t(I18nKey.articleEditorToolbarBoldPlaceholder),
            markPreviewDirty,
        );
        return;
    }
    if (action === "italic") {
        applyWrapAction(
            editor,
            "*",
            "*",
            t(I18nKey.articleEditorToolbarItalicPlaceholder),
            markPreviewDirty,
        );
        return;
    }
    if (action === "underline") {
        applyWrapAction(
            editor,
            "<u>",
            "</u>",
            t(I18nKey.articleEditorToolbarUnderlinePlaceholder),
            markPreviewDirty,
        );
        return;
    }
    if (action === "strike") {
        applyWrapAction(
            editor,
            "~~",
            "~~",
            t(I18nKey.articleEditorToolbarStrikePlaceholder),
            markPreviewDirty,
        );
        return;
    }
    if (action === "quote") {
        applyQuoteAction(editor, markPreviewDirty);
        return;
    }
    if (action === "inline-code") {
        applyWrapAction(
            editor,
            "`",
            "`",
            t(I18nKey.articleEditorToolbarInlineCodePlaceholder),
            markPreviewDirty,
        );
        return;
    }
    applyCodeBlockAction(editor, markPreviewDirty);
}
