/**
 * 发布页面预览辅助函数
 *
 * 封装 Markdown 实时预览的调度、渲染与 API 结果处理。
 */

import { emitAuthState } from "@/scripts/auth-state";
import {
    type MarkdownPreviewClient,
    normalizeMarkdownPreviewHtml,
} from "@/scripts/markdown-preview-client";
import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    type PublishRuntimeWindow,
    refreshMarkdownRuntime,
} from "@/scripts/publish-page-helpers";
import type { PublishDomRefs } from "@/scripts/publish-page-dom";
import type { PublishState } from "@/scripts/publish-page-submit";

// ── 类型 ──

export type PreviewHelpers = {
    renderPreview: () => void;
    resetPreviewState: () => void;
    schedulePreview: () => void;
    markPreviewDirty: () => void;
    requestPreview: (
        mode: "fast" | "full",
        generation: number,
        force?: boolean,
    ) => Promise<void>;
};

// ── 内部辅助 ──

function handlePreviewApiResult(
    result: {
        aborted: boolean;
        unauthorized: boolean;
        error?: string;
        html: string;
    },
    source: string,
    mode: "fast" | "full",
    state: PublishState,
): boolean {
    if (result.aborted) {
        return true;
    }
    if (result.unauthorized) {
        emitAuthState({
            isLoggedIn: false,
            isAdmin: false,
            userId: "",
            username: "",
        });
        state.previewHtml = "";
        state.previewError = t(I18nKey.articleEditorPreviewLoginRequired);
        state.previewDirty = true;
        return true;
    }
    if (result.error) {
        state.previewError = result.error;
        state.previewDirty = true;
        return true;
    }
    state.previewSource = source;
    state.previewHtml = normalizeMarkdownPreviewHtml(result.html);
    state.previewError = "";
    if (mode === "full") {
        state.previewDirty = false;
    }
    return false;
}

function makeRenderPreview(
    dom: PublishDomRefs,
    state: PublishState,
    runtimeWindow: PublishRuntimeWindow,
): () => void {
    return function renderPreview(): void {
        if (!dom.previewErrorEl || !dom.previewContentEl) {
            return;
        }
        if (state.previewError) {
            dom.previewErrorEl.textContent = state.previewError;
            dom.previewErrorEl.classList.remove("hidden");
        } else {
            dom.previewErrorEl.textContent = "";
            dom.previewErrorEl.classList.add("hidden");
        }
        if (state.previewHtml) {
            if (state.renderedPreviewHtml !== state.previewHtml) {
                dom.previewContentEl.innerHTML = state.previewHtml;
                state.renderedPreviewHtml = state.previewHtml;
                void refreshMarkdownRuntime(runtimeWindow);
            }
            dom.previewContentEl.classList.remove("hidden");
            return;
        }
        dom.previewContentEl.innerHTML = "";
        state.renderedPreviewHtml = "";
        dom.previewContentEl.classList.add("hidden");
    };
}

function applyEmptySourcePreview(
    source: string,
    state: PublishState,
    renderPreview: () => void,
): void {
    state.previewSource = source;
    state.previewHtml = "";
    state.previewError = "";
    state.previewDirty = false;
    renderPreview();
}

function applyNotLoggedInPreview(
    source: string,
    state: PublishState,
    renderPreview: () => void,
): void {
    state.previewSource = source;
    state.previewHtml = "";
    state.previewError = t(I18nKey.articleEditorPreviewLoginRequired);
    state.previewDirty = false;
    renderPreview();
}

async function fetchAndApplyPreview(
    source: string,
    mode: "fast" | "full",
    generation: number,
    force: boolean,
    state: PublishState,
    previewClient: MarkdownPreviewClient,
    renderPreview: () => void,
): Promise<void> {
    try {
        const result = await previewClient.preview(source, { force, mode });
        if (generation !== state.previewGeneration) {
            return;
        }
        handlePreviewApiResult(result, source, mode, state);
    } catch (error) {
        console.error("[publish] preview failed:", error);
        if (generation !== state.previewGeneration) {
            return;
        }
        state.previewHtml = "";
        state.previewError = t(I18nKey.articleEditorPreviewFailedRetry);
        state.previewDirty = true;
    } finally {
        if (generation === state.previewGeneration) {
            renderPreview();
        }
    }
}

function makeRequestPreview(
    dom: PublishDomRefs,
    state: PublishState,
    previewClient: MarkdownPreviewClient,
    renderPreview: () => void,
): (
    mode: "fast" | "full",
    generation: number,
    force?: boolean,
) => Promise<void> {
    return async function requestPreview(
        mode: "fast" | "full",
        generation: number,
        force = false,
    ): Promise<void> {
        if (generation !== state.previewGeneration) {
            return;
        }
        const source = String(dom.articleBodyInput.value || "");
        const trimmed = source.trim();
        if (
            !force &&
            mode === "fast" &&
            !state.previewDirty &&
            source === state.previewSource
        ) {
            return;
        }
        if (!trimmed) {
            applyEmptySourcePreview(source, state, renderPreview);
            return;
        }
        if (!state.isLoggedIn) {
            applyNotLoggedInPreview(source, state, renderPreview);
            return;
        }

        state.previewError = "";

        if (mode === "fast") {
            const incrementalHtml = previewClient.getIncrementalPreview(source);
            if (incrementalHtml) {
                state.previewHtml = incrementalHtml;
            }
        }
        renderPreview();

        await fetchAndApplyPreview(
            source,
            mode,
            generation,
            force,
            state,
            previewClient,
            renderPreview,
        );
    };
}

// ── 公开工厂函数 ──

export function makePreviewHelpers(
    dom: PublishDomRefs,
    state: PublishState,
    previewClient: MarkdownPreviewClient,
    runtimeWindow: PublishRuntimeWindow,
): PreviewHelpers {
    const renderPreview = makeRenderPreview(dom, state, runtimeWindow);
    const requestPreview = makeRequestPreview(
        dom,
        state,
        previewClient,
        renderPreview,
    );

    const resetPreviewState = (): void => {
        state.previewSource = "";
        state.previewHtml = "";
        state.previewError = "";
        state.previewDirty = false;
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

    const schedulePreview = (): void => {
        if (state.previewFastTimer !== null) {
            window.clearTimeout(state.previewFastTimer);
        }
        if (state.previewFullTimer !== null) {
            window.clearTimeout(state.previewFullTimer);
        }
        const generation = state.previewGeneration;
        const fastDelay = previewClient.getFastDebounceDelay();
        const fullDelay = previewClient.getFullDebounceDelay();
        state.previewFastTimer = window.setTimeout(() => {
            state.previewFastTimer = null;
            void requestPreview("fast", generation);
        }, fastDelay);
        state.previewFullTimer = window.setTimeout(() => {
            state.previewFullTimer = null;
            void requestPreview("full", generation);
        }, fullDelay);
    };

    const markPreviewDirty = (): void => {
        state.previewDirty = true;
        state.previewGeneration += 1;
        schedulePreview();
    };

    return {
        renderPreview,
        resetPreviewState,
        schedulePreview,
        markPreviewDirty,
        requestPreview,
    };
}
