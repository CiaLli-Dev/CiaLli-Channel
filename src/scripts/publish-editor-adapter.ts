/**
 * 发布页编辑器适配层。
 *
 * 统一发布页编辑器能力接口，让业务逻辑不直接耦合 Monaco API。
 */

export type PublishEditorSelection = {
    start: number;
    end: number;
};

export type PublishEditorScrollState = {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
};

export type PublishEditorListener = () => void;
export type PublishEditorPasteListener = (event: ClipboardEvent) => void;

export interface PublishEditorAdapter {
    getValue(): string;
    setValue(value: string): void;
    focus(): void;
    getSelection(): PublishEditorSelection;
    setSelection(start: number, end: number): void;
    replaceSelection(
        replacement: string,
        selectionStartOffset: number,
        selectionEndOffset: number,
    ): void;
    onInput(listener: PublishEditorListener): () => void;
    onBlur(listener: PublishEditorListener): () => void;
    onScroll(listener: PublishEditorListener): () => void;
    onPaste(listener: PublishEditorPasteListener): () => void;
    getScrollState(): PublishEditorScrollState;
    setScrollTop(scrollTop: number): void;
    layout(): void;
    dispose(): void;
}
