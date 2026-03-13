import { getCsrfToken } from "@/utils/csrf";

export type MarkdownPreviewTarget = "article" | "diary" | "bulletin" | "about";
export type MarkdownPreviewMode = "fast" | "full";

export type MarkdownPreviewResult = {
    html: string;
    error: string;
    unauthorized: boolean;
    aborted: boolean;
    fromCache: boolean;
};

type PreviewClientOptions = {
    cacheSize?: number;
};

type PreviewApiResult = {
    response: Response;
    data: Record<string, unknown> | null;
};

type PreviewTask = {
    cacheKey: string;
    source: string;
    mode: MarkdownPreviewMode;
    force: boolean;
    waiters: Array<(result: MarkdownPreviewResult) => void>;
};

const PREVIEW_ENDPOINT_MAP: Record<MarkdownPreviewTarget, string> = {
    article: "/api/v1/me/articles/preview",
    diary: "/api/v1/me/diaries/preview",
    bulletin: "/api/v1/admin/settings/bulletin/preview",
    about: "/api/v1/admin/settings/about/preview",
};

const FAST_DEBOUNCE_DELAY = 120;
const FULL_DEBOUNCE_DELAY = 650;

function buildPayload(
    target: MarkdownPreviewTarget,
    source: string,
    mode: MarkdownPreviewMode,
): Record<string, unknown> {
    if (target === "article") {
        return { body_markdown: source, render_mode: mode };
    }
    if (target === "diary") {
        return { content: source, render_mode: mode };
    }
    return { body_markdown: source, render_mode: mode };
}

function toStringValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    return "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function getApiMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    const message = toStringValue(data?.message);
    if (message) {
        return message;
    }
    const error = toRecord(data?.error);
    const errorMessage = toStringValue(error?.message);
    return errorMessage || fallback;
}

function hasHtmlTag(value: string): boolean {
    return /<[a-z][\w:-]*(\s[^>]*)?>/i.test(value);
}

function decodeHtmlEntities(value: string): string {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return String(textarea.value || "");
}

export function normalizeMarkdownPreviewHtml(raw: unknown): string {
    const source = String(raw || "").trim();
    if (!source) {
        return "";
    }
    if (hasHtmlTag(source)) {
        return source;
    }
    if (source.includes("&lt;") || source.includes("&#")) {
        const decoded = decodeHtmlEntities(source).trim();
        if (hasHtmlTag(decoded)) {
            return decoded;
        }
    }
    return source;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function renderInlineFast(value: string): string {
    let output = escapeHtml(value);
    const codeTokens: string[] = [];

    output = output.replace(/`([^`\n]+)`/g, (_full, code: string) => {
        const index = codeTokens.push(code) - 1;
        return `%%INLINE_CODE_${index}%%`;
    });

    output = output
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

    output = output.replace(/%%INLINE_CODE_(\d+)%%/g, (_full, rawIndex) => {
        const index = Number(rawIndex);
        const code = codeTokens[index] ?? "";
        return `<code>${code}</code>`;
    });

    return output;
}

function renderCodeBlock(block: string): string {
    const normalized = block.replace(/\r\n/g, "\n");
    const match = normalized.match(/^```([^\n]*)\n([\s\S]*?)\n```$/);
    if (!match) {
        return `<pre><code>${escapeHtml(normalized)}</code></pre>`;
    }
    const language = String(match[1] || "").trim();
    const content = String(match[2] || "");
    const languageClass = language
        ? ` class="language-${escapeHtml(language)}"`
        : "";
    return `<pre><code${languageClass}>${escapeHtml(content)}</code></pre>`;
}

function renderListBlock(block: string, ordered: boolean): string {
    const normalized = block.replace(/\r\n/g, "\n");
    const lines = normalized
        .split("\n")
        .filter((line) => line.trim().length > 0);
    const tag = ordered ? "ol" : "ul";
    const items = lines
        .map((line) => {
            const content = ordered
                ? line.replace(/^\d+\.\s+/, "")
                : line.replace(/^[-*+]\s+/, "");
            return `<li>${renderInlineFast(content)}</li>`;
        })
        .join("");
    return `<${tag}>${items}</${tag}>`;
}

function renderQuoteBlock(block: string): string {
    const normalized = block.replace(/\r\n/g, "\n");
    const content = normalized
        .split("\n")
        .map((line) => line.replace(/^>\s?/, ""))
        .join("\n");
    return `<blockquote><p>${renderInlineFast(content).replace(/\n/g, "<br>")}</p></blockquote>`;
}

function renderHeadingBlock(block: string): string {
    const normalized = block.replace(/\r\n/g, "\n");
    const match = normalized.match(/^(#{1,6})\s+([\s\S]*)$/);
    if (!match) {
        return `<p>${renderInlineFast(normalized).replace(/\n/g, "<br>")}</p>`;
    }
    const level = Math.min(6, match[1].length);
    const content = match[2] || "";
    return `<h${level}>${renderInlineFast(content)}</h${level}>`;
}

function splitBlocks(source: string): string[] {
    return source
        .replace(/\r\n/g, "\n")
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0);
}

function renderBlockFast(block: string): string {
    if (block.startsWith("```")) {
        return renderCodeBlock(block);
    }
    if (/^#{1,6}\s+/.test(block)) {
        return renderHeadingBlock(block);
    }
    if (block.split("\n").every((line) => /^>\s?/.test(line))) {
        return renderQuoteBlock(block);
    }
    if (block.split("\n").every((line) => /^[-*+]\s+/.test(line))) {
        return renderListBlock(block, false);
    }
    if (block.split("\n").every((line) => /^\d+\.\s+/.test(line))) {
        return renderListBlock(block, true);
    }
    return `<p>${renderInlineFast(block).replace(/\n/g, "<br>")}</p>`;
}

async function previewApi(
    url: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<PreviewApiResult> {
    const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;
    return { response, data };
}

function createAbortedResult(): MarkdownPreviewResult {
    return {
        html: "",
        error: "",
        unauthorized: false,
        aborted: true,
        fromCache: false,
    };
}

export class MarkdownPreviewClient {
    private readonly target: MarkdownPreviewTarget;

    private readonly endpoint: string;

    private readonly cache = new Map<string, string>();

    private readonly cacheSize: number;

    private incrementalBlocks: string[] = [];

    private incrementalBlockHtml: string[] = [];

    private isProcessing = false;

    private currentTask: PreviewTask | null = null;

    private queuedTask: PreviewTask | null = null;

    private activeController: AbortController | null = null;

    constructor(
        target: MarkdownPreviewTarget,
        options: PreviewClientOptions = {},
    ) {
        this.target = target;
        this.endpoint = PREVIEW_ENDPOINT_MAP[target];
        this.cacheSize = Math.max(20, Math.floor(options.cacheSize || 80));
    }

    getAdaptiveDebounceDelay(_source: string): number {
        return FAST_DEBOUNCE_DELAY;
    }

    getFastDebounceDelay(): number {
        return FAST_DEBOUNCE_DELAY;
    }

    getFullDebounceDelay(): number {
        return FULL_DEBOUNCE_DELAY;
    }

    async preview(
        source: string,
        options: { force?: boolean; mode?: MarkdownPreviewMode } = {},
    ): Promise<MarkdownPreviewResult> {
        const rawSource = String(source || "");
        const trimmedSource = rawSource.trim();
        const mode = options.mode || "full";
        const force = Boolean(options.force);

        if (!trimmedSource) {
            return {
                html: "",
                error: "",
                unauthorized: false,
                aborted: false,
                fromCache: false,
            };
        }

        const cacheKey = `${this.target}:${mode}:${trimmedSource}`;
        if (!force && this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey) || "";
            this.promoteCache(cacheKey, cached);
            return {
                html: cached,
                error: "",
                unauthorized: false,
                aborted: false,
                fromCache: true,
            };
        }

        return await this.enqueueTask({
            cacheKey,
            source: trimmedSource,
            mode,
            force,
        });
    }

    getIncrementalPreview(source: string): string {
        const blocks = splitBlocks(String(source || ""));
        if (blocks.length === 0) {
            this.incrementalBlocks = [];
            this.incrementalBlockHtml = [];
            return "";
        }

        const nextHtml: string[] = new Array(blocks.length);
        for (let i = 0; i < blocks.length; i += 1) {
            const block = blocks[i];
            if (this.incrementalBlocks[i] === block) {
                nextHtml[i] = this.incrementalBlockHtml[i] || "";
                continue;
            }
            nextHtml[i] = renderBlockFast(block);
        }

        this.incrementalBlocks = blocks;
        this.incrementalBlockHtml = nextHtml;
        return nextHtml.join("\n");
    }

    resetIncrementalState(): void {
        this.incrementalBlocks = [];
        this.incrementalBlockHtml = [];
    }

    dispose(): void {
        if (this.activeController) {
            this.activeController.abort();
            this.activeController = null;
        }
        if (this.currentTask) {
            for (const waiter of this.currentTask.waiters) {
                waiter(createAbortedResult());
            }
            this.currentTask = null;
        }
        if (this.queuedTask) {
            for (const waiter of this.queuedTask.waiters) {
                waiter(createAbortedResult());
            }
            this.queuedTask = null;
        }
        this.isProcessing = false;
        this.resetIncrementalState();
    }

    private async enqueueTask(input: {
        cacheKey: string;
        source: string;
        mode: MarkdownPreviewMode;
        force: boolean;
    }): Promise<MarkdownPreviewResult> {
        return await new Promise<MarkdownPreviewResult>((resolve) => {
            const { cacheKey, source, mode, force } = input;

            if (this.currentTask && this.currentTask.cacheKey === cacheKey) {
                this.currentTask.waiters.push(resolve);
                return;
            }

            if (this.queuedTask && this.queuedTask.cacheKey === cacheKey) {
                this.queuedTask.waiters.push(resolve);
                return;
            }

            const nextTask: PreviewTask = {
                cacheKey,
                source,
                mode,
                force,
                waiters: [resolve],
            };

            if (!this.currentTask && !this.isProcessing) {
                this.currentTask = nextTask;
                void this.consumeQueue();
                return;
            }

            if (this.queuedTask) {
                for (const waiter of this.queuedTask.waiters) {
                    waiter(createAbortedResult());
                }
            }
            this.queuedTask = nextTask;
        });
    }

    private async consumeQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;

        try {
            while (this.currentTask || this.queuedTask) {
                if (!this.currentTask && this.queuedTask) {
                    this.currentTask = this.queuedTask;
                    this.queuedTask = null;
                }
                const task = this.currentTask;
                if (!task) {
                    continue;
                }
                const result = await this.executeTask(task);
                for (const waiter of task.waiters) {
                    waiter(result);
                }
                this.currentTask = null;
            }
        } finally {
            this.isProcessing = false;
        }
    }

    private async executeTask(
        task: PreviewTask,
    ): Promise<MarkdownPreviewResult> {
        const controller = new AbortController();
        this.activeController = controller;

        try {
            const payload = buildPayload(this.target, task.source, task.mode);
            const { response, data } = await previewApi(
                this.endpoint,
                payload,
                controller.signal,
            );

            if (response.status === 401) {
                return {
                    html: "",
                    error: "请先登录后预览内容。",
                    unauthorized: true,
                    aborted: false,
                    fromCache: false,
                };
            }

            if (!response.ok || !data?.ok) {
                return {
                    html: "",
                    error: getApiMessage(data, "预览生成失败"),
                    unauthorized: false,
                    aborted: false,
                    fromCache: false,
                };
            }

            const html = normalizeMarkdownPreviewHtml(data.body_html);
            this.promoteCache(task.cacheKey, html);
            return {
                html,
                error: "",
                unauthorized: false,
                aborted: false,
                fromCache: false,
            };
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                return createAbortedResult();
            }
            console.error("[markdown-preview] request failed:", error);
            return {
                html: "",
                error: "预览生成失败，请稍后重试",
                unauthorized: false,
                aborted: false,
                fromCache: false,
            };
        } finally {
            if (this.activeController === controller) {
                this.activeController = null;
            }
        }
    }

    private promoteCache(key: string, html: string): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        this.cache.set(key, html);
        if (this.cache.size <= this.cacheSize) {
            return;
        }
        const oldest = this.cache.keys().next().value;
        if (typeof oldest === "string") {
            this.cache.delete(oldest);
        }
    }
}
