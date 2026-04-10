/**
 * 发布页面 DOM 节点类型定义与收集函数
 *
 * 仅依赖 DOM API，不依赖业务逻辑状态。
 */

// ── DOM 引用类型 ──

export type PublishDomRefs = {
    workspaceEl: HTMLElement;
    settingsOverlayEl: HTMLElement | null;
    openSettingsBtn: HTMLButtonElement | null;
    cancelSettingsBtn: HTMLButtonElement | null;
    currentHintEl: HTMLElement | null;
    editorTitleEl: HTMLElement;
    previewErrorEl: HTMLElement | null;
    previewContentEl: HTMLElement | null;
    previewScrollEl: HTMLElement | null;
    toolbarEl: HTMLElement;
    submitMsgEl: HTMLElement;
    submitErrorEl: HTMLElement;
    saveDraftBtn: HTMLButtonElement;
    savePublishedBtn: HTMLButtonElement;
    discardDraftBtn: HTMLButtonElement;
    coverCropBtn: HTMLButtonElement | null;
    coverClearBtn: HTMLButtonElement | null;
    coverMsgEl: HTMLElement | null;
    coverPreviewWrapEl: HTMLElement | null;
    coverPreviewEl: HTMLImageElement | null;
    articleTitleInput: HTMLInputElement;
    articleTitleHintEl: HTMLElement | null;
    articleSummaryInput: HTMLTextAreaElement;
    articleBodyInput: HTMLTextAreaElement;
    editorMonacoEl: HTMLElement | null;
    articleCoverUrlInput: HTMLInputElement;
    articleTagsInput: HTMLInputElement;
    articleCategoryInput: HTMLInputElement;
    articleAllowCommentsInput: HTMLInputElement;
    articleIsPublicInput: HTMLInputElement;
    articleEncryptEnabledInput: HTMLInputElement;
    articleEncryptPanelEl: HTMLElement;
    articleEncryptPasswordInput: HTMLInputElement;
    articleEncryptHintEl: HTMLElement | null;
};

// ── 必填 DOM 节点收集 ──

type RequiredDomNodes = {
    workspaceEl: HTMLElement;
    editorTitleEl: HTMLElement;
    toolbarEl: HTMLElement;
    submitMsgEl: HTMLElement;
    submitErrorEl: HTMLElement;
    saveDraftBtn: HTMLButtonElement;
    savePublishedBtn: HTMLButtonElement;
    discardDraftBtn: HTMLButtonElement;
    articleTitleInput: HTMLInputElement;
    articleSummaryInput: HTMLTextAreaElement;
    articleBodyInput: HTMLTextAreaElement;
    articleCoverUrlInput: HTMLInputElement;
    articleTagsInput: HTMLInputElement;
    articleCategoryInput: HTMLInputElement;
    articleAllowCommentsInput: HTMLInputElement;
    articleIsPublicInput: HTMLInputElement;
    articleEncryptEnabledInput: HTMLInputElement;
    articleEncryptPanelEl: HTMLElement;
    articleEncryptPasswordInput: HTMLInputElement;
};

function getRequiredDomNodesCoreGroup(): {
    workspaceEl: HTMLElement | null;
    editorTitleEl: HTMLElement | null;
    toolbarEl: HTMLElement | null;
    submitMsgEl: HTMLElement | null;
    submitErrorEl: HTMLElement | null;
    saveDraftBtn: HTMLButtonElement | null;
    savePublishedBtn: HTMLButtonElement | null;
    discardDraftBtn: HTMLButtonElement | null;
} {
    return {
        workspaceEl: document.getElementById("publish-workspace"),
        editorTitleEl: document.getElementById("publish-editor-title"),
        toolbarEl: document.getElementById("publish-toolbar"),
        submitMsgEl: document.getElementById("publish-submit-msg"),
        submitErrorEl: document.getElementById("publish-submit-error"),
        saveDraftBtn: document.getElementById(
            "publish-save-draft",
        ) as HTMLButtonElement | null,
        savePublishedBtn: document.getElementById(
            "publish-save-published",
        ) as HTMLButtonElement | null,
        discardDraftBtn: document.getElementById(
            "publish-discard-draft",
        ) as HTMLButtonElement | null,
    };
}

function getRequiredDomNodesFormGroup(): {
    articleTitleInput: HTMLInputElement | null;
    articleSummaryInput: HTMLTextAreaElement | null;
    articleBodyInput: HTMLTextAreaElement | null;
    articleCoverUrlInput: HTMLInputElement | null;
    articleTagsInput: HTMLInputElement | null;
    articleCategoryInput: HTMLInputElement | null;
    articleAllowCommentsInput: HTMLInputElement | null;
    articleIsPublicInput: HTMLInputElement | null;
    articleEncryptEnabledInput: HTMLInputElement | null;
    articleEncryptPanelEl: HTMLElement | null;
    articleEncryptPasswordInput: HTMLInputElement | null;
} {
    return {
        articleTitleInput: document.getElementById(
            "publish-article-title",
        ) as HTMLInputElement | null,
        articleSummaryInput: document.getElementById(
            "publish-article-summary",
        ) as HTMLTextAreaElement | null,
        articleBodyInput: document.getElementById(
            "publish-article-body",
        ) as HTMLTextAreaElement | null,
        articleCoverUrlInput: document.getElementById(
            "publish-article-cover-url",
        ) as HTMLInputElement | null,
        articleTagsInput: document.getElementById(
            "publish-article-tags",
        ) as HTMLInputElement | null,
        articleCategoryInput: document.getElementById(
            "publish-article-category",
        ) as HTMLInputElement | null,
        articleAllowCommentsInput: document.getElementById(
            "publish-article-allow-comments",
        ) as HTMLInputElement | null,
        articleIsPublicInput: document.getElementById(
            "publish-article-is-public",
        ) as HTMLInputElement | null,
        articleEncryptEnabledInput: document.getElementById(
            "publish-article-encrypt-enabled",
        ) as HTMLInputElement | null,
        articleEncryptPanelEl: document.getElementById(
            "publish-article-encrypt-panel",
        ),
        articleEncryptPasswordInput: document.getElementById(
            "publish-article-encrypt-password",
        ) as HTMLInputElement | null,
    };
}

function isCoreGroupComplete(
    core: ReturnType<typeof getRequiredDomNodesCoreGroup>,
): core is {
    workspaceEl: HTMLElement;
    editorTitleEl: HTMLElement;
    toolbarEl: HTMLElement;
    submitMsgEl: HTMLElement;
    submitErrorEl: HTMLElement;
    saveDraftBtn: HTMLButtonElement;
    savePublishedBtn: HTMLButtonElement;
    discardDraftBtn: HTMLButtonElement;
} {
    return Boolean(
        core.workspaceEl &&
        core.editorTitleEl &&
        core.toolbarEl &&
        core.submitMsgEl &&
        core.submitErrorEl &&
        core.saveDraftBtn &&
        core.savePublishedBtn &&
        core.discardDraftBtn,
    );
}

function isFormGroupComplete(
    form: ReturnType<typeof getRequiredDomNodesFormGroup>,
): form is {
    articleTitleInput: HTMLInputElement;
    articleSummaryInput: HTMLTextAreaElement;
    articleBodyInput: HTMLTextAreaElement;
    articleCoverUrlInput: HTMLInputElement;
    articleTagsInput: HTMLInputElement;
    articleCategoryInput: HTMLInputElement;
    articleAllowCommentsInput: HTMLInputElement;
    articleIsPublicInput: HTMLInputElement;
    articleEncryptEnabledInput: HTMLInputElement;
    articleEncryptPanelEl: HTMLElement;
    articleEncryptPasswordInput: HTMLInputElement;
} {
    return Boolean(
        form.articleTitleInput &&
        form.articleSummaryInput &&
        form.articleBodyInput &&
        form.articleCoverUrlInput &&
        form.articleTagsInput &&
        form.articleCategoryInput &&
        form.articleAllowCommentsInput &&
        form.articleIsPublicInput &&
        form.articleEncryptEnabledInput &&
        form.articleEncryptPanelEl &&
        form.articleEncryptPasswordInput,
    );
}

function getRequiredDomNodes(): RequiredDomNodes | null {
    const core = getRequiredDomNodesCoreGroup();
    const form = getRequiredDomNodesFormGroup();

    if (!isCoreGroupComplete(core) || !isFormGroupComplete(form)) {
        return null;
    }

    return { ...core, ...form };
}

export function collectDomRefs(): PublishDomRefs | null {
    const required = getRequiredDomNodes();
    if (!required) {
        console.warn("[publish] required dom nodes missing");
        return null;
    }

    return {
        ...required,
        settingsOverlayEl: document.getElementById("publish-settings-overlay"),
        openSettingsBtn: document.getElementById(
            "publish-open-settings",
        ) as HTMLButtonElement | null,
        cancelSettingsBtn: document.getElementById(
            "publish-cancel-settings",
        ) as HTMLButtonElement | null,
        editorMonacoEl: document.getElementById("publish-editor-monaco"),
        currentHintEl: document.getElementById("publish-current-hint"),
        previewErrorEl: document.getElementById("publish-preview-error"),
        previewContentEl: document.getElementById("publish-preview-content"),
        previewScrollEl: document.getElementById("publish-preview-scroll"),
        coverCropBtn: document.getElementById(
            "publish-cover-crop-btn",
        ) as HTMLButtonElement | null,
        coverClearBtn: document.getElementById(
            "publish-cover-clear-btn",
        ) as HTMLButtonElement | null,
        coverMsgEl: document.getElementById("publish-cover-msg"),
        coverPreviewWrapEl: document.getElementById(
            "publish-cover-preview-wrap",
        ),
        coverPreviewEl: document.getElementById(
            "publish-cover-preview",
        ) as HTMLImageElement | null,
        articleTitleHintEl: document.getElementById(
            "publish-article-title-hint",
        ),
        articleEncryptHintEl: document.getElementById(
            "publish-article-encrypt-hint",
        ),
    };
}
