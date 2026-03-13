import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { parse as htmlParser } from "node-html-parser";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import rehypeExpressiveCode, {
    type RehypeExpressiveCodeOptions,
} from "rehype-expressive-code";
import rehypeParse from "rehype-parse";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { cacheManager } from "@/server/cache/manager";

import { pluginCustomCopyButton } from "../../plugins/expressive-code/custom-copy-button";
import { pluginLanguageBadge } from "../../plugins/expressive-code/language-badge";
import {
    getRuntimeMarkdownPlugins,
    type RuntimeMarkdownFeatures,
} from "./pipeline";
import { sanitizeMarkdownHtml } from "./sanitize";

export type MarkdownRenderTarget = "page" | "feed" | "encrypted";
export type MarkdownRenderMode = "full" | "fast";

export type RenderMarkdownOptions = {
    target?: MarkdownRenderTarget;
    site?: URL;
    mode?: MarkdownRenderMode;
    allowBlobImages?: boolean;
};

/**
 * Markdown 渲染缓存版本：
 * 当 sanitize 或渲染策略发生行为变化时递增，主动淘汰旧缓存，避免命中历史 HTML。
 */
const MARKDOWN_CACHE_VERSION = "v2";

const expressiveCodeOptions: RehypeExpressiveCodeOptions = {
    themes: ["github-light", "github-dark"],
    plugins: [
        pluginCollapsibleSections(),
        pluginLineNumbers(),
        pluginLanguageBadge(),
        pluginCustomCopyButton(),
    ],
    defaultProps: {
        wrap: true,
        overridesByLang: {
            shellsession: { showLineNumbers: false },
            bash: { frame: "code" },
            shell: { frame: "code" },
            sh: { frame: "code" },
            zsh: { frame: "code" },
        },
    },
    styleOverrides: {
        codeBackground: "var(--codeblock-bg)",
        borderRadius: "0.75rem",
        borderColor: "none",
        codeFontSize: "0.875rem",
        codeFontFamily:
            "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        codeLineHeight: "1.5rem",
        frames: {
            editorBackground: "var(--codeblock-bg)",
            terminalBackground: "var(--codeblock-bg)",
            terminalTitlebarBackground: "var(--codeblock-bg)",
            editorTabBarBackground: "var(--codeblock-bg)",
            editorActiveTabBackground: "none",
            editorActiveTabIndicatorBottomColor: "var(--primary)",
            editorActiveTabIndicatorTopColor: "none",
            editorTabBarBorderBottomColor: "var(--codeblock-bg)",
            terminalTitlebarBorderBottomColor: "none",
        },
        textMarkers: {
            delHue: "0",
            insHue: "180",
            markHue: "250",
        },
    },
    frames: {
        showCopyToClipboardButton: false,
    },
};

const expressiveCodeProcessor = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeExpressiveCode, expressiveCodeOptions)
    .use(rehypeStringify, {
        allowDangerousHtml: true,
    });

function toAbsoluteSrc(src: string, site: URL): string {
    if (/^(?:https?:)?\/\//i.test(src) || src.startsWith("data:")) {
        return src;
    }
    if (src.startsWith("/")) {
        return new URL(src, site).href;
    }
    const normalized = src.replace(/^\.\/+/, "").replace(/^\.\.\/+/, "");
    return new URL(`/${normalized}`, site).href;
}

function normalizeFeedHtml(html: string, site?: URL): string {
    if (!html) {
        return "";
    }
    const root = htmlParser.parse(html);
    if (site) {
        for (const image of root.querySelectorAll("img")) {
            const src = image.getAttribute("src");
            if (!src) {
                continue;
            }
            image.setAttribute("src", toAbsoluteSrc(src, site));
        }
    }
    return root.toString();
}

export function detectMarkdownFeatures(
    source: string,
): RuntimeMarkdownFeatures {
    const hasMath =
        /(^|\n)\s*\$\$[\s\S]*?\$\$\s*(\n|$)/m.test(source) ||
        /(^|[^\\])\$[^$\n]+\$/.test(source);

    const hasDirective =
        /(^|\n)\s*::[a-z0-9_-]*/im.test(source) ||
        /(^|\n)\s*:[a-z][\w-]*\[/im.test(source) ||
        /(^|\n)\s*>\s*\[![a-z]+\]/im.test(source);

    const hasMermaid = /```\s*mermaid\b/i.test(source);

    return {
        hasMath,
        hasDirective,
        hasMermaid,
    };
}

function getFeatureMask(features: RuntimeMarkdownFeatures): string {
    return [
        features.hasMath ? "1" : "0",
        features.hasDirective ? "1" : "0",
        features.hasMermaid ? "1" : "0",
    ].join("");
}

function createMarkdownProcessor(
    mode: MarkdownRenderMode,
    features: RuntimeMarkdownFeatures,
) {
    const runtimePlugins = getRuntimeMarkdownPlugins(mode, features);
    return unified()
        .use(remarkParse)
        .use(runtimePlugins.remarkPlugins)
        .use(remarkRehype, {
            allowDangerousHtml: true,
        })
        .use(rehypeRaw)
        .use(runtimePlugins.rehypePlugins)
        .use(rehypeStringify, {
            allowDangerousHtml: true,
        });
}

type MarkdownProcessor = ReturnType<typeof createMarkdownProcessor>;

const runtimeProcessorCache = new Map<string, MarkdownProcessor>();

function getMarkdownProcessor(
    mode: MarkdownRenderMode,
    features: RuntimeMarkdownFeatures,
): MarkdownProcessor {
    const key = `${mode}:${getFeatureMask(features)}`;
    const cached = runtimeProcessorCache.get(key);
    if (cached) {
        return cached;
    }

    const processor = createMarkdownProcessor(mode, features);
    runtimeProcessorCache.set(key, processor);
    return processor;
}

function shouldLogRenderMetrics(): boolean {
    const debugFlag = String(process.env.MARKDOWN_RENDER_DEBUG || "")
        .trim()
        .toLowerCase();
    return (
        process.env.NODE_ENV !== "production" ||
        debugFlag === "1" ||
        debugFlag === "true"
    );
}

function logRenderMetrics(params: {
    target: MarkdownRenderTarget;
    mode: MarkdownRenderMode;
    parseTransformMs: number;
    sanitizeMs: number;
    expressiveMs: number;
    totalMs: number;
    cache: "hit" | "miss";
}): void {
    if (!shouldLogRenderMetrics()) {
        return;
    }
    const {
        target,
        mode,
        parseTransformMs,
        sanitizeMs,
        expressiveMs,
        totalMs,
        cache,
    } = params;
    console.info(
        `[markdown] target=${target} mode=${mode} cache=${cache} parse+transform=${parseTransformMs.toFixed(2)}ms sanitize=${sanitizeMs.toFixed(2)}ms expressive=${expressiveMs.toFixed(2)}ms total=${totalMs.toFixed(2)}ms`,
    );
}

type RenderTimings = {
    parseTransformMs: number;
    sanitizeMs: number;
    expressiveMs: number;
};

type ParseAndSanitizeResult = {
    sanitizedHtml: string;
    timings: Pick<RenderTimings, "parseTransformMs" | "sanitizeMs">;
};

async function parseAndSanitize(
    source: string,
    mode: MarkdownRenderMode,
    allowBlobImages: boolean,
    features: RuntimeMarkdownFeatures,
): Promise<ParseAndSanitizeResult> {
    const processor = getMarkdownProcessor(mode, features);

    const parseTransformStart = performance.now();
    const rendered = await processor.process(source);
    const parseTransformMs = performance.now() - parseTransformStart;

    const sanitizeStart = performance.now();
    const sanitizedHtml = sanitizeMarkdownHtml(String(rendered.value || ""), {
        allowBlobImages,
    });
    const sanitizeMs = performance.now() - sanitizeStart;

    return { sanitizedHtml, timings: { parseTransformMs, sanitizeMs } };
}

async function applyExpressiveCode(sanitizedHtml: string): Promise<{
    result: string;
    expressiveMs: number;
}> {
    const expressiveStart = performance.now();
    try {
        const highlighted =
            await expressiveCodeProcessor.process(sanitizedHtml);
        return {
            result: String(highlighted.value || ""),
            expressiveMs: performance.now() - expressiveStart,
        };
    } catch (error) {
        console.error("[markdown] expressive code render failed:", error);
        return {
            result: sanitizedHtml,
            expressiveMs: performance.now() - expressiveStart,
        };
    }
}

export async function renderMarkdown(
    markdown: string,
    options: RenderMarkdownOptions = {},
): Promise<string> {
    const totalStart = performance.now();
    const {
        target = "page",
        site,
        mode = "full",
        allowBlobImages = false,
    } = options;
    const source = String(markdown || "");
    if (!source.trim()) {
        return "";
    }

    const hashInput = target === "feed" && site ? source + site.href : source;
    const hash = createHash("sha256").update(hashInput).digest("hex");
    const cacheKey = `${MARKDOWN_CACHE_VERSION}:${target}:${mode}:${allowBlobImages ? "blob" : "strict"}:${hash}`;

    const cached = await cacheManager.get<string>("markdown", cacheKey);
    if (cached !== null) {
        logRenderMetrics({
            target,
            mode,
            parseTransformMs: 0,
            sanitizeMs: 0,
            expressiveMs: 0,
            totalMs: performance.now() - totalStart,
            cache: "hit",
        });
        return cached;
    }

    const features = detectMarkdownFeatures(source);
    const { sanitizedHtml, timings } = await parseAndSanitize(
        source,
        mode,
        allowBlobImages,
        features,
    );
    const { parseTransformMs, sanitizeMs } = timings;

    if (!sanitizedHtml) {
        logRenderMetrics({
            target,
            mode,
            parseTransformMs,
            sanitizeMs,
            expressiveMs: 0,
            totalMs: performance.now() - totalStart,
            cache: "miss",
        });
        return "";
    }

    if (target === "feed") {
        const result = normalizeFeedHtml(sanitizedHtml, site);
        void cacheManager.set("markdown", cacheKey, result);
        logRenderMetrics({
            target,
            mode,
            parseTransformMs,
            sanitizeMs,
            expressiveMs: 0,
            totalMs: performance.now() - totalStart,
            cache: "miss",
        });
        return result;
    }

    if (mode === "fast" || !sanitizedHtml.includes("<pre><code")) {
        void cacheManager.set("markdown", cacheKey, sanitizedHtml);
        logRenderMetrics({
            target,
            mode,
            parseTransformMs,
            sanitizeMs,
            expressiveMs: 0,
            totalMs: performance.now() - totalStart,
            cache: "miss",
        });
        return sanitizedHtml;
    }

    const { result, expressiveMs } = await applyExpressiveCode(sanitizedHtml);
    void cacheManager.set("markdown", cacheKey, result);
    logRenderMetrics({
        target,
        mode,
        parseTransformMs,
        sanitizeMs,
        expressiveMs,
        totalMs: performance.now() - totalStart,
        cache: "miss",
    });
    return result;
}

export async function renderMarkdownHtml(markdown: string): Promise<string> {
    return renderMarkdown(markdown, { target: "page" });
}

export async function renderMarkdownForFeed(
    markdown: string,
    site: URL,
): Promise<string> {
    return renderMarkdown(markdown, { target: "feed", site });
}
