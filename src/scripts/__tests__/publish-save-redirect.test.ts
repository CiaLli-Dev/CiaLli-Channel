import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    ARTICLE_SAVE_SUCCESS_REDIRECT_URL,
    buildArticleDetailSuccessRedirectUrl,
    buildDiarySaveSuccessRedirectUrl,
} from "@/scripts/shared/editor-save-redirect";
import { EDITOR_SAVE_FRESHNESS_PARAM } from "@/utils/editor-save-freshness";

const navigateToPage = vi.fn();
const requestApi = vi.fn();

vi.mock("@/utils/navigation-utils", () => ({
    navigateToPage,
}));

vi.mock("@/scripts/shared/http-client", () => ({
    requestApi,
}));

describe("publish save redirect", () => {
    beforeEach(() => {
        navigateToPage.mockClear();
        requestApi.mockReset();
    });

    it("文章草稿保存成功后返回文章列表", async () => {
        const { handleSubmitApiResponse } =
            await import("@/scripts/publish/page-submit");
        await handleSubmitApiResponse(
            makePublishState(),
            makeUiHelpers(),
            async () => true,
            "",
            { item: { id: "draft-1", short_id: "draft-short" } },
            {
                successRedirectUrl: ARTICLE_SAVE_SUCCESS_REDIRECT_URL,
                targetStatus: "draft",
            },
        );

        expect(navigateToPage).toHaveBeenCalledWith("/posts", {
            force: true,
            replace: true,
        });
    });

    it("文章发布和保存修改成功后进入文章详情页", async () => {
        const { handleSubmitApiResponse } =
            await import("@/scripts/publish/page-submit");
        await handleSubmitApiResponse(
            makePublishState(),
            makeUiHelpers(),
            async () => true,
            "",
            {
                item: {
                    id: "post-1",
                    short_id: "post-short",
                    slug: "published post",
                },
            },
            {
                targetStatus: "published",
            },
        );
        await handleSubmitApiResponse(
            makePublishState({ currentStatus: "published" }),
            makeUiHelpers(),
            async () => true,
            "",
            { item: { id: "post-1", short_id: "post-short" } },
            {
                targetStatus: "published",
            },
        );

        expect(navigateToPage).toHaveBeenCalledTimes(2);
        expect(navigateToPage).toHaveBeenNthCalledWith(
            1,
            expect.stringMatching(
                new RegExp(
                    `^/posts/published%20post\\?${EDITOR_SAVE_FRESHNESS_PARAM}=`,
                ),
            ),
            {
                force: true,
                replace: true,
            },
        );
        expect(navigateToPage).toHaveBeenNthCalledWith(
            2,
            expect.stringMatching(
                new RegExp(
                    `^/posts/post-short\\?${EDITOR_SAVE_FRESHNESS_PARAM}=`,
                ),
            ),
            {
                force: true,
                replace: true,
            },
        );
    });

    it("文章未保存守卫保存路径不触发列表跳转", async () => {
        const { handleSubmitApiResponse } =
            await import("@/scripts/publish/page-submit");
        await handleSubmitApiResponse(
            makePublishState(),
            makeUiHelpers(),
            async () => true,
            "",
            { item: { id: "draft-1", short_id: "draft-short" } },
            {
                redirectOnSuccess: false,
                targetStatus: "draft",
            },
        );

        expect(navigateToPage).not.toHaveBeenCalled();
    });

    it("文章保存失败时保留当前编辑内容和待上传缓存且不跳转", async () => {
        const { submit } = await import("@/scripts/publish/page-submit");
        const originalBody = "正文 ![](blob:article-local-image)";
        const pendingUploads = new Map([
            [
                "blob:article-local-image",
                {
                    file: new File(["image"], "article.png", {
                        type: "image/png",
                    }),
                    localUrl: "blob:article-local-image",
                    purpose: "inline" as const,
                    fileName: "article.png",
                },
            ],
        ]);
        const dom = makePublishDomRefs(originalBody);
        const state = makePublishState({
            currentItemId: "post-1",
            currentStatus: "published",
        });
        const ui = makeUiHelpers();
        const fillForm = vi.fn(async () => true);
        const revokeObjectUrl = vi
            .spyOn(URL, "revokeObjectURL")
            .mockImplementation(() => undefined);
        requestApi
            .mockResolvedValueOnce({
                response: new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                }),
                data: {
                    ok: true,
                    file: { id: "file-1" },
                },
            })
            .mockResolvedValueOnce({
                response: new Response(JSON.stringify({ ok: false }), {
                    status: 500,
                }),
                data: {
                    ok: false,
                    error: { message: "保存失败" },
                },
            });

        const saved = await submit(
            {
                dom,
                state,
                pendingUploads,
                saveOverlay: makeSaveOverlay(),
                previewClient: makePreviewClient(),
                ui,
                fillForm,
            },
            { targetStatus: "published" },
        );

        expect(saved).toBe(false);
        expect(navigateToPage).not.toHaveBeenCalled();
        expect(fillForm).not.toHaveBeenCalled();
        expect(dom.articleBodyInput.value).toBe(originalBody);
        expect(pendingUploads.has("blob:article-local-image")).toBe(true);
        expect(revokeObjectUrl).not.toHaveBeenCalled();

        revokeObjectUrl.mockRestore();
    });

    it("日记跳转目标由同一共享模块生成", () => {
        expect(buildDiarySaveSuccessRedirectUrl("alice")).toBe("/alice/diary");
        expect(
            buildArticleDetailSuccessRedirectUrl({
                id: "post-1",
                short_id: "post-short",
            }),
        ).toBe("/posts/post-short");
    });
});

function makePublishState(
    overrides: Partial<
        import("@/scripts/publish/page-submit").PublishState
    > = {},
): import("@/scripts/publish/page-submit").PublishState {
    return {
        currentItemId: "",
        currentItemShortId: "",
        currentStatus: "",
        currentCoverFileId: "",
        currentUsername: "alice",
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
        ...overrides,
    };
}

function makePublishDomRefs(
    body: string,
): import("@/scripts/publish/page-dom").PublishDomRefs {
    return {
        workspaceEl: {} as HTMLElement,
        settingsOverlayEl: null,
        openSettingsBtn: null,
        cancelSettingsBtn: null,
        currentHintEl: null,
        editorTitleEl: {} as HTMLElement,
        previewErrorEl: null,
        previewContentEl: null,
        previewScrollEl: null,
        toolbarEl: {} as HTMLElement,
        submitMsgEl: {} as HTMLElement,
        submitErrorEl: {} as HTMLElement,
        saveDraftBtn: {
            disabled: false,
            textContent: "保存草稿",
        } as HTMLButtonElement,
        savePublishedBtn: {
            disabled: false,
            textContent: "发布",
        } as HTMLButtonElement,
        discardDraftBtn: {
            disabled: false,
            textContent: "删除",
        } as HTMLButtonElement,
        coverCropBtn: null,
        coverClearBtn: null,
        coverMsgEl: null,
        coverPreviewWrapEl: null,
        coverPreviewEl: null,
        articleTitleInput: { value: "标题" } as HTMLInputElement,
        articleTitleHintEl: null,
        articleSummaryInput: { value: "" } as HTMLTextAreaElement,
        articleBodyInput: { value: body } as HTMLTextAreaElement,
        editorMonacoEl: null,
        articleCoverUrlInput: { value: "" } as HTMLInputElement,
        articleTagsInput: { value: "" } as HTMLInputElement,
        articleCategoryInput: { value: "" } as HTMLInputElement,
        articleAllowCommentsInput: { checked: true } as HTMLInputElement,
        articleIsPublicInput: { checked: true } as HTMLInputElement,
        articleEncryptEnabledInput: { checked: false } as HTMLInputElement,
        articleEncryptPanelEl: {} as HTMLElement,
        articleEncryptPasswordInput: { value: "" } as HTMLInputElement,
        articleEncryptHintEl: null,
    };
}

function makeSaveOverlay(): import("@/scripts/shared/save-progress-overlay").SaveProgressOverlay {
    return {
        show: vi.fn(),
        hide: vi.fn(),
        update: vi.fn(),
        destroy: vi.fn(),
    } as unknown as import("@/scripts/shared/save-progress-overlay").SaveProgressOverlay;
}

function makePreviewClient(): import("@/scripts/markdown/preview-client").MarkdownPreviewClient {
    return {
        preview: vi.fn(),
    } as unknown as import("@/scripts/markdown/preview-client").MarkdownPreviewClient;
}

function makeUiHelpers(): import("@/scripts/publish/page-submit").UiHelpers {
    return {
        setSubmitError: vi.fn(),
        setSubmitMessage: vi.fn(),
        setCoverMessage: vi.fn(),
        updateEncryptHint: vi.fn(),
        updateEncryptPanel: vi.fn(),
        updateTitleHint: vi.fn(),
        updateEditorHeader: vi.fn(),
        updateSettingsActions: vi.fn(),
        updateUrlState: vi.fn(),
        updateCoverPreview: vi.fn(),
    };
}
