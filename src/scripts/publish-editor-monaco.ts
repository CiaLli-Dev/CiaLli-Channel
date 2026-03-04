/**
 * 发布页 Monaco 编辑器初始化与适配。
 *
 * - 按需动态加载 Monaco，避免首屏主包膨胀。
 * - 页面仅使用 Monaco，不提供 textarea 回退。
 */

import {
    type PublishEditorAdapter,
    type PublishEditorListener,
    type PublishEditorPasteListener,
    type PublishEditorScrollState,
    type PublishEditorSelection,
} from "@/scripts/publish-editor-adapter";

type MonacoModule = typeof import("monaco-editor");
type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;

type MonacoRuntimeWindow = Window &
    typeof globalThis & {
        MonacoEnvironment?: {
            getWorker: (_moduleId: string, label: string) => Worker;
        };
        __publishMonacoWorkerReady?: boolean;
    };

export type CreatePublishEditorAdapterOptions = {
    textareaEl: HTMLTextAreaElement;
    monacoHostEl: HTMLElement | null;
};

function clampOffset(offset: number, length: number): number {
    if (!Number.isFinite(offset)) {
        return 0;
    }
    if (offset < 0) {
        return 0;
    }
    if (offset > length) {
        return length;
    }
    return offset;
}

function resolveMonacoTheme(): "vs" | "vs-dark" {
    const root = document.documentElement;
    const dataTheme = String(root.getAttribute("data-theme") || "");
    const isDark =
        root.classList.contains("dark") || dataTheme.includes("dark");
    return isDark ? "vs-dark" : "vs";
}

function bindMonacoThemeSync(monaco: MonacoModule): () => void {
    // 监听主题切换：避免夜间模式下 Monaco 配色与全站主题不同步。
    const applyTheme = (): void => {
        monaco.editor.setTheme(resolveMonacoTheme());
    };
    applyTheme();

    const observer = new MutationObserver(() => {
        applyTheme();
    });
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
    });

    return () => {
        observer.disconnect();
    };
}

async function ensureMonacoWorkers(): Promise<void> {
    const runtimeWindow = window as MonacoRuntimeWindow;
    if (runtimeWindow.__publishMonacoWorkerReady) {
        return;
    }

    const [
        { default: EditorWorker },
        { default: JsonWorker },
        { default: CssWorker },
        { default: HtmlWorker },
        { default: TsWorker },
    ] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.worker?worker"),
        import("monaco-editor/esm/vs/language/json/json.worker?worker"),
        import("monaco-editor/esm/vs/language/css/css.worker?worker"),
        import("monaco-editor/esm/vs/language/html/html.worker?worker"),
        import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
    ]);

    runtimeWindow.MonacoEnvironment = {
        getWorker(_moduleId: string, label: string): Worker {
            if (label === "json") {
                return new JsonWorker();
            }
            if (label === "css" || label === "scss" || label === "less") {
                return new CssWorker();
            }
            if (
                label === "html" ||
                label === "handlebars" ||
                label === "razor"
            ) {
                return new HtmlWorker();
            }
            if (label === "typescript" || label === "javascript") {
                return new TsWorker();
            }
            return new EditorWorker();
        },
    };

    runtimeWindow.__publishMonacoWorkerReady = true;
}

class MonacoEditorAdapter implements PublishEditorAdapter {
    private readonly disposeHandlers: Array<() => void> = [];

    constructor(
        private readonly monaco: MonacoModule,
        private readonly editor: MonacoEditor,
        private readonly textareaEl: HTMLTextAreaElement,
        themeDispose: () => void,
    ) {
        this.disposeHandlers.push(themeDispose);
        this.syncTextareaValue();
    }

    private getModel(): import("monaco-editor").editor.ITextModel | null {
        return this.editor.getModel();
    }

    private syncTextareaValue(): void {
        this.textareaEl.value = this.getValue();
    }

    getValue(): string {
        const model = this.getModel();
        if (!model) {
            return "";
        }
        return model.getValue();
    }

    setValue(value: string): void {
        const model = this.getModel();
        if (!model) {
            return;
        }
        model.setValue(value);
        this.syncTextareaValue();
    }

    focus(): void {
        this.editor.focus();
    }

    getSelection(): PublishEditorSelection {
        const model = this.getModel();
        const selection = this.editor.getSelection();
        if (!model || !selection) {
            return { start: 0, end: 0 };
        }
        const start = model.getOffsetAt(selection.getStartPosition());
        const end = model.getOffsetAt(selection.getEndPosition());
        return { start, end };
    }

    setSelection(start: number, end: number): void {
        const model = this.getModel();
        if (!model) {
            return;
        }

        const length = model.getValueLength();
        const safeStart = clampOffset(start, length);
        const safeEnd = clampOffset(end, length);
        const startPosition = model.getPositionAt(safeStart);
        const endPosition = model.getPositionAt(safeEnd);
        const selection = new this.monaco.Selection(
            startPosition.lineNumber,
            startPosition.column,
            endPosition.lineNumber,
            endPosition.column,
        );
        this.editor.setSelection(selection);
    }

    replaceSelection(
        replacement: string,
        selectionStartOffset: number,
        selectionEndOffset: number,
    ): void {
        const model = this.getModel();
        if (!model) {
            return;
        }

        const currentSelection = this.editor.getSelection();
        const baseSelection =
            currentSelection ?? new this.monaco.Selection(1, 1, 1, 1);
        const startOffset = model.getOffsetAt(baseSelection.getStartPosition());

        this.editor.executeEdits("publish-editor", [
            {
                range: baseSelection,
                text: replacement,
                forceMoveMarkers: true,
            },
        ]);

        const nextStart = startOffset + selectionStartOffset;
        const nextEnd = startOffset + selectionEndOffset;
        this.focus();
        this.setSelection(nextStart, nextEnd);
        this.syncTextareaValue();
    }

    onInput(listener: PublishEditorListener): () => void {
        const disposable = this.editor.onDidChangeModelContent(() => {
            this.syncTextareaValue();
            listener();
        });
        const dispose = () => {
            disposable.dispose();
        };
        this.disposeHandlers.push(dispose);
        return dispose;
    }

    onBlur(listener: PublishEditorListener): () => void {
        const disposable = this.editor.onDidBlurEditorText(() => {
            listener();
        });
        const dispose = () => {
            disposable.dispose();
        };
        this.disposeHandlers.push(dispose);
        return dispose;
    }

    onScroll(listener: PublishEditorListener): () => void {
        const disposable = this.editor.onDidScrollChange(() => {
            listener();
        });
        const dispose = () => {
            disposable.dispose();
        };
        this.disposeHandlers.push(dispose);
        return dispose;
    }

    onPaste(listener: PublishEditorPasteListener): () => void {
        const domNode = this.editor.getDomNode();
        if (!domNode) {
            return () => {
                // 无 DOM 节点时无需清理。
            };
        }

        const wrapped = (event: Event): void => {
            if (event instanceof ClipboardEvent) {
                listener(event);
            }
        };
        domNode.addEventListener("paste", wrapped);
        const dispose = () => {
            domNode.removeEventListener("paste", wrapped);
        };
        this.disposeHandlers.push(dispose);
        return dispose;
    }

    getScrollState(): PublishEditorScrollState {
        return {
            scrollTop: this.editor.getScrollTop(),
            scrollHeight: this.editor.getScrollHeight(),
            clientHeight: this.editor.getLayoutInfo().height,
        };
    }

    setScrollTop(scrollTop: number): void {
        this.editor.setScrollTop(scrollTop);
    }

    dispose(): void {
        while (this.disposeHandlers.length > 0) {
            const dispose = this.disposeHandlers.pop();
            dispose?.();
        }
        this.editor.dispose();
    }
}

async function createMonacoAdapter(
    monacoHostEl: HTMLElement,
    textareaEl: HTMLTextAreaElement,
): Promise<PublishEditorAdapter> {
    await ensureMonacoWorkers();
    const monaco = await import("monaco-editor");

    const editor = monaco.editor.create(monacoHostEl, {
        value: textareaEl.value || "",
        language: "markdown",
        automaticLayout: true,
        scrollBeyondLastLine: false,
        minimap: { enabled: false },
        wordWrap: "on",
        fontSize: 14,
        lineNumbers: "on",
        tabSize: 2,
        // 发布页默认允许中文内容，关闭 Unicode 高亮告警以避免中文标点被误报。
        unicodeHighlight: {
            ambiguousCharacters: false,
            invisibleCharacters: false,
            nonBasicASCII: false,
        },
    });

    const themeDispose = bindMonacoThemeSync(monaco);
    return new MonacoEditorAdapter(monaco, editor, textareaEl, themeDispose);
}

export async function createPublishEditorAdapter(
    options: CreatePublishEditorAdapterOptions,
): Promise<PublishEditorAdapter> {
    const { textareaEl, monacoHostEl } = options;

    if (!monacoHostEl) {
        throw new Error("[publish] monaco mount element not found");
    }

    return createMonacoAdapter(monacoHostEl, textareaEl);
}
