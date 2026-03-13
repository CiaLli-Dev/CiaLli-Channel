/* eslint-disable max-lines -- Monaco 适配集中承载 worker/theme/layout 恢复逻辑，保持单模块更便于排查切页问题。 */
/**
 * 发布页 Monaco 编辑器初始化与适配。
 *
 */

import {
    type PublishEditorAdapter,
    type PublishEditorListener,
    type PublishEditorPasteListener,
    type PublishEditorScrollState,
    type PublishEditorSelection,
} from "@/scripts/publish-editor-adapter";
import { analyzeMarkdownSyntax } from "@/scripts/publish-editor-markdown-diagnostics";
import {
    ensurePublishMonacoStylesheet,
    ensurePublishMonacoThemeServiceStyles,
} from "@/scripts/publish-editor-monaco-styles";

type MonacoModule = typeof import("monaco-editor");
type MonacoEditor = import("monaco-editor").editor.IStandaloneCodeEditor;

type MonacoRuntimeWindow = Window &
    typeof globalThis & {
        MonacoEnvironment?: {
            getWorker: (_moduleId: string, label: string) => Worker;
        };
        __publishMonacoWorkerReady?: boolean;
        __publishMonacoThemeReady?: boolean;
    };

const PUBLISH_MONACO_LIGHT_THEME = "cialli-markdown-light";
const PUBLISH_MONACO_DARK_THEME = "cialli-markdown-dark";
const NAVIGATION_SETTLED_EVENT = "cialli:navigation:settled";

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

function resolveMonacoTheme():
    | typeof PUBLISH_MONACO_LIGHT_THEME
    | typeof PUBLISH_MONACO_DARK_THEME {
    const root = document.documentElement;
    const dataTheme = String(root.getAttribute("data-theme") || "");
    const isDark =
        root.classList.contains("dark") || dataTheme.includes("dark");
    return isDark ? PUBLISH_MONACO_DARK_THEME : PUBLISH_MONACO_LIGHT_THEME;
}

function ensurePublishMonacoThemes(monaco: MonacoModule): void {
    const runtimeWindow = window as MonacoRuntimeWindow;
    if (runtimeWindow.__publishMonacoThemeReady) {
        return;
    }

    // 按 Markdown token 粒度增强高亮，避免默认主题下语法层次不明显。
    monaco.editor.defineTheme(PUBLISH_MONACO_LIGHT_THEME, {
        base: "vs",
        inherit: true,
        rules: [
            { token: "keyword.md", foreground: "0f3d91", fontStyle: "bold" },
            { token: "meta.separator.md", foreground: "5b4b8a" },
            { token: "strong.md", foreground: "8e2d2d", fontStyle: "bold" },
            { token: "emphasis.md", foreground: "8e2d2d", fontStyle: "italic" },
            {
                token: "string.link.md",
                foreground: "0b63c9",
                fontStyle: "underline",
            },
            { token: "variable.md", foreground: "b42318" },
            { token: "string.md", foreground: "0a6b2c" },
            { token: "variable.source.md", foreground: "0a6b2c" },
            { token: "comment.md", foreground: "6f7177", fontStyle: "italic" },
        ],
        colors: {},
    });

    monaco.editor.defineTheme(PUBLISH_MONACO_DARK_THEME, {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "keyword.md", foreground: "79a8ff", fontStyle: "bold" },
            { token: "meta.separator.md", foreground: "c2a8ff" },
            { token: "strong.md", foreground: "ff8f8f", fontStyle: "bold" },
            { token: "emphasis.md", foreground: "ff8f8f", fontStyle: "italic" },
            {
                token: "string.link.md",
                foreground: "7ec9ff",
                fontStyle: "underline",
            },
            { token: "variable.md", foreground: "ffb86c" },
            { token: "string.md", foreground: "8ddf8d" },
            { token: "variable.source.md", foreground: "8ddf8d" },
            { token: "comment.md", foreground: "9da5b4", fontStyle: "italic" },
        ],
        colors: {},
    });

    runtimeWindow.__publishMonacoThemeReady = true;
}

function bindMonacoThemeSync(monaco: MonacoModule): () => void {
    ensurePublishMonacoThemes(monaco);
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

function bindMarkdownSyntaxDiagnostics(
    monaco: MonacoModule,
    editor: MonacoEditor,
): () => void {
    const model = editor.getModel();
    if (!model) {
        return () => {
            // 无 model 时无需额外清理。
        };
    }

    const owner = "publish-markdown-syntax";
    let timer: number | null = null;

    const applyMarkers = (): void => {
        const markers = analyzeMarkdownSyntax(model.getValue()).map((item) => ({
            startLineNumber: item.line,
            startColumn: item.startColumn,
            endLineNumber: item.line,
            endColumn:
                item.endColumn > item.startColumn
                    ? item.endColumn
                    : item.startColumn + 1,
            message: item.message,
            severity:
                item.severity === "error"
                    ? monaco.MarkerSeverity.Error
                    : monaco.MarkerSeverity.Warning,
        }));
        monaco.editor.setModelMarkers(model, owner, markers);
    };

    const scheduleMarkers = (): void => {
        if (timer !== null) {
            window.clearTimeout(timer);
        }
        // 输入过程中做轻量防抖，减少频繁 setModelMarkers 带来的抖动。
        timer = window.setTimeout(() => {
            timer = null;
            applyMarkers();
        }, 160);
    };

    applyMarkers();
    const disposable = editor.onDidChangeModelContent(() => {
        scheduleMarkers();
    });

    return () => {
        if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
        }
        disposable.dispose();
        monaco.editor.setModelMarkers(model, owner, []);
    };
}

function hasRenderableMonacoHostRect(hostEl: HTMLElement): boolean {
    const rect = hostEl.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

async function waitForRenderableMonacoHost(hostEl: HTMLElement): Promise<void> {
    if (hasRenderableMonacoHostRect(hostEl)) {
        return;
    }

    await new Promise<void>((resolve) => {
        let resolved = false;
        let timeoutId: number | null = null;
        let frameId: number | null = null;
        let resizeObserver: ResizeObserver | null = null;

        const cleanup = (): void => {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
                frameId = null;
            }
            resizeObserver?.disconnect();
            resizeObserver = null;
            document.removeEventListener(NAVIGATION_SETTLED_EVENT, onProbe);
        };

        const finish = (): void => {
            if (resolved) {
                return;
            }
            resolved = true;
            cleanup();
            resolve();
        };

        const onProbe = (): void => {
            if (hasRenderableMonacoHostRect(hostEl)) {
                finish();
                return;
            }
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
            frameId = window.requestAnimationFrame(() => {
                frameId = null;
                if (hasRenderableMonacoHostRect(hostEl)) {
                    finish();
                }
            });
        };

        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(() => {
                onProbe();
            });
            resizeObserver.observe(hostEl);
        }

        document.addEventListener(NAVIGATION_SETTLED_EVENT, onProbe);
        timeoutId = window.setTimeout(() => {
            // 不让编辑器初始化无限等待；若宿主仍不可测量，则交给后续补 layout 兜底。
            finish();
        }, 800);
        onProbe();
    });
}

function bindMonacoLayoutRecovery(
    editor: MonacoEditor,
    hostEl: HTMLElement,
): () => void {
    const timeoutIds = new Set<number>();
    const frameIds = new Set<number>();
    let resizeObserver: ResizeObserver | null = null;

    const layoutIfConnected = (): void => {
        if (!hostEl.isConnected) {
            return;
        }
        editor.layout();
    };

    const scheduleLayout = (delay = 0): void => {
        if (delay <= 0) {
            const frameId = window.requestAnimationFrame(() => {
                frameIds.delete(frameId);
                layoutIfConnected();
            });
            frameIds.add(frameId);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            timeoutIds.delete(timeoutId);
            layoutIfConnected();
        }, delay);
        timeoutIds.add(timeoutId);
    };

    const handleNavigationSettled = (): void => {
        scheduleLayout();
        scheduleLayout(120);
    };

    scheduleLayout();
    scheduleLayout(120);
    scheduleLayout(320);
    document.addEventListener(
        NAVIGATION_SETTLED_EVENT,
        handleNavigationSettled,
    );

    if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
            scheduleLayout();
        });
        resizeObserver.observe(hostEl);
    }

    return () => {
        for (const timeoutId of timeoutIds) {
            window.clearTimeout(timeoutId);
        }
        timeoutIds.clear();

        for (const frameId of frameIds) {
            window.cancelAnimationFrame(frameId);
        }
        frameIds.clear();

        resizeObserver?.disconnect();
        document.removeEventListener(
            NAVIGATION_SETTLED_EVENT,
            handleNavigationSettled,
        );
    };
}

async function ensureMonacoWorkers(): Promise<void> {
    const runtimeWindow = window as MonacoRuntimeWindow;
    if (runtimeWindow.__publishMonacoWorkerReady) {
        return;
    }

    const { default: EditorWorker } =
        await import("monaco-editor/esm/vs/editor/editor.worker?worker");

    runtimeWindow.MonacoEnvironment = {
        getWorker(_moduleId: string, _label: string): Worker {
            // 发布编辑器仅使用 Markdown，不需要 JSON/CSS/HTML/TS 语言 worker。
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
        disposeTasks: Array<() => void>,
    ) {
        this.disposeHandlers.push(...disposeTasks);
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
        const handledEvents = new WeakSet<Event>();

        const wrapped = (event: Event): void => {
            if (event.type !== "paste") {
                return;
            }
            // 同一个 paste 事件可能在 document 与编辑器容器上都命中，需去重防止重复上传。
            if (handledEvents.has(event)) {
                return;
            }
            // 只在当前 Monaco 文本区聚焦时分发，避免页面其他输入框粘贴被误处理。
            if (!this.editor.hasTextFocus()) {
                return;
            }
            const clipboardEvent = event as ClipboardEvent;
            if (!clipboardEvent.clipboardData) {
                return;
            }
            handledEvents.add(event);
            listener(clipboardEvent);
        };

        document.addEventListener("paste", wrapped, true);
        if (domNode) {
            domNode.addEventListener("paste", wrapped, true);
        }

        const dispose = () => {
            document.removeEventListener("paste", wrapped, true);
            if (domNode) {
                domNode.removeEventListener("paste", wrapped, true);
            }
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

    layout(): void {
        this.editor.layout();
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
    const [monacoModule] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.api"),
        import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"),
    ]);
    const monaco = monacoModule as MonacoModule;

    // Astro ClientRouter 会替换整个 document，导致旧文档里动态注入的 Monaco CSS 丢失。
    // 若当前文档缺少样式，这里先补齐稳定入口，再创建编辑器实例。
    await ensurePublishMonacoStylesheet();
    // Monaco 会把主题 CSS 缓存在全局 theme service 的 style 节点里。
    // 客户端换 document 后，这个缓存节点会留在旧文档，导致新文档丢失 `.monaco-colors`。
    await ensurePublishMonacoThemeServiceStyles(monacoHostEl);
    // 客户端二次进入时，发布页工作台可能仍处于切页收尾阶段；
    // 先等待宿主容器至少变成“可测量”，避免 Monaco 在 0 尺寸窗口里创建后卡成空白框。
    await waitForRenderableMonacoHost(monacoHostEl);

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
    const diagnosticsDispose = bindMarkdownSyntaxDiagnostics(monaco, editor);
    const layoutRecoveryDispose = bindMonacoLayoutRecovery(
        editor,
        monacoHostEl,
    );
    return new MonacoEditorAdapter(monaco, editor, textareaEl, [
        themeDispose,
        diagnosticsDispose,
        layoutRecoveryDispose,
    ]);
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
