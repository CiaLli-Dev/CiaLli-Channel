import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { buildSubmitPayload } from "@/scripts/publish/page-submit";
import type { PublishDomRefs } from "@/scripts/publish/page-dom";
import type { PublishState } from "@/scripts/publish/page-submit";
import { syncArticleSummaryInputForAiMode } from "@/scripts/publish/summary-mode";

vi.mock("@/utils/navigation-utils", () => ({
    navigateToPage: vi.fn(),
}));

const publishSettingsOverlayPath = fileURLToPath(
    new URL(
        "../../components/publish/PublishSettingsOverlay.astro",
        import.meta.url,
    ),
);
const publishPageDomPath = fileURLToPath(
    new URL("../publish/page-dom.ts", import.meta.url),
);
const publishPageSubmitPath = fileURLToPath(
    new URL("../publish/page-submit.ts", import.meta.url),
);
const articleDetailPagePath = fileURLToPath(
    new URL("../../pages/posts/[id].astro", import.meta.url),
);

describe("publish AI summary UI", () => {
    it("保存弹层提供 AI 总结开关并进入提交 payload", () => {
        const overlaySource = readFileSync(publishSettingsOverlayPath, "utf8");
        const domSource = readFileSync(publishPageDomPath, "utf8");
        const submitSource = readFileSync(publishPageSubmitPath, "utf8");

        expect(overlaySource).toContain("publish-article-ai-summary-enabled");
        expect(overlaySource).toContain("articleEditorAiSummaryEnabled");
        expect(overlaySource).toContain("publish-article-summary--ai-locked");
        expect(domSource).toContain("articleAiSummaryEnabledInput");
        expect(submitSource).toContain("ai_summary_enabled");
    });

    it("文章详情页将所有摘要渲染为卡片，仅 AI 生成态使用占位", () => {
        const detailSource = readFileSync(articleDetailPagePath, "utf8");

        expect(detailSource).toContain("summary_source");
        expect(detailSource).toContain("article-ai-summary-card");
        expect(detailSource).toContain('summary_source === "ai"');
        expect(detailSource).toContain('summary_source === "manual"');
        expect(detailSource).toContain("hasStaticSummaryCard");
        expect(detailSource).toContain("showPendingAiSummarySkeleton");
        expect(detailSource).toContain("article-ai-summary-card--marquee");
        expect(detailSource).toContain("article-ai-summary-card-marquee");
        expect(detailSource).not.toContain(
            'article.summary && article.summary_source !== "ai"',
        );
    });

    it("开启 AI 摘要时清空并禁用手写摘要输入框", () => {
        const { dom, classes } = makeSummaryModeDom({
            summary: "手写摘要",
            aiSummaryEnabled: true,
        });

        syncArticleSummaryInputForAiMode(dom, { clearWhenEnabled: true });

        expect(dom.articleSummaryInput.value).toBe("");
        expect(dom.articleSummaryInput.disabled).toBe(true);
        expect(dom.articleSummaryInput.getAttribute("aria-disabled")).toBe(
            "true",
        );
        expect(classes.has("publish-article-summary--ai-locked")).toBe(true);
        expect(classes.has("cursor-not-allowed")).toBe(true);
        expect(classes.has("opacity-60")).toBe(true);
    });

    it("关闭 AI 摘要时恢复摘要输入框为可编辑", () => {
        const { dom, classes } = makeSummaryModeDom({
            summary: "",
            aiSummaryEnabled: false,
            initialClasses: [
                "publish-article-summary--ai-locked",
                "cursor-not-allowed",
                "opacity-60",
            ],
        });
        dom.articleSummaryInput.disabled = true;

        syncArticleSummaryInputForAiMode(dom, { clearWhenEnabled: true });

        expect(dom.articleSummaryInput.value).toBe("");
        expect(dom.articleSummaryInput.disabled).toBe(false);
        expect(dom.articleSummaryInput.getAttribute("aria-disabled")).toBe(
            "false",
        );
        expect(classes.has("publish-article-summary--ai-locked")).toBe(false);
        expect(classes.has("cursor-not-allowed")).toBe(false);
        expect(classes.has("opacity-60")).toBe(false);
    });

    it("开启 AI 摘要时提交 payload 会清空 summary", () => {
        const payload = buildSubmitPayload(
            makeSubmitDom({
                summary: "手写摘要",
                aiSummaryEnabled: true,
            }),
            makePublishState(),
            "# Body",
            null,
            "published",
        );

        expect(payload.summary).toBeNull();
        expect(payload.ai_summary_enabled).toBe(true);
    });

    it("关闭 AI 摘要时提交 payload 会保留手写摘要", () => {
        const payload = buildSubmitPayload(
            makeSubmitDom({
                summary: "手写摘要",
                aiSummaryEnabled: false,
            }),
            makePublishState(),
            "# Body",
            null,
            "published",
        );

        expect(payload.summary).toBe("手写摘要");
        expect(payload.ai_summary_enabled).toBe(false);
    });
});

function makeSummaryModeDom(input: {
    summary: string;
    aiSummaryEnabled: boolean;
    initialClasses?: string[];
}): {
    dom: Parameters<typeof syncArticleSummaryInputForAiMode>[0];
    classes: Set<string>;
} {
    const attributes = new Map<string, string>();
    const classes = new Set(input.initialClasses ?? []);
    const articleSummaryInput = {
        value: input.summary,
        disabled: false,
        setAttribute: (name: string, value: string) => {
            attributes.set(name, value);
        },
        getAttribute: (name: string) => attributes.get(name) ?? null,
        classList: {
            toggle: (token: string, force?: boolean) => {
                const enabled = force ?? !classes.has(token);
                if (enabled) {
                    classes.add(token);
                } else {
                    classes.delete(token);
                }
                return enabled;
            },
        },
    } as unknown as HTMLTextAreaElement;
    const articleAiSummaryEnabledInput = {
        checked: input.aiSummaryEnabled,
    } as HTMLInputElement;

    return {
        dom: {
            articleAiSummaryEnabledInput,
            articleSummaryInput,
        },
        classes,
    };
}

function makeSubmitDom(input: {
    summary: string;
    aiSummaryEnabled: boolean;
}): PublishDomRefs {
    return {
        articleTitleInput: { value: "标题" } as HTMLInputElement,
        articleSummaryInput: {
            value: input.summary,
        } as HTMLTextAreaElement,
        articleAiSummaryEnabledInput: {
            checked: input.aiSummaryEnabled,
        } as HTMLInputElement,
        articleCoverUrlInput: { value: "" } as HTMLInputElement,
        articleTagsInput: { value: "" } as HTMLInputElement,
        articleCategoryInput: { value: "" } as HTMLInputElement,
        articleAllowCommentsInput: { checked: true } as HTMLInputElement,
        articleIsPublicInput: { checked: true } as HTMLInputElement,
    } as PublishDomRefs;
}

function makePublishState(): PublishState {
    return {
        currentItemId: "",
        currentItemShortId: "",
        currentStatus: "",
        currentCoverFileId: "",
        currentUsername: "",
        isLoggedIn: true,
        previewError: "",
        previewHtml: "",
        previewSource: "",
        previewDirty: false,
        renderedPreviewHtml: "",
        previewGeneration: 0,
        previewFastTimer: null,
        previewFullTimer: null,
        initializedAfterLogin: true,
        loadedEncryptedBody: "",
        loadedEncryptedBodyUnlocked: false,
        inlineImageCounter: 0,
    };
}
