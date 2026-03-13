/* eslint-disable complexity, max-lines -- 发布页提交链路需要保持上传、加密与提交状态在同一文件内收敛。 */
/**
 * 发布页面提交逻辑
 *
 * 包含表单验证、上传物化、Body 构建与 API 调用。
 */

import { emitAuthState } from "@/scripts/auth-state";
import { showAuthRequiredDialog } from "@/scripts/dialogs";
import type { MarkdownPreviewClient } from "@/scripts/markdown-preview-client";
import { normalizeMarkdownPreviewHtml } from "@/scripts/markdown-preview-client";
import type { SaveProgressOverlay } from "@/scripts/save-progress-overlay";
import { ARTICLE_TITLE_MAX, weightedCharLength } from "@/constants/text-limits";
import I18nKey from "@/i18n/i18nKey";
import { requestApi as api } from "@/scripts/http-client";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { buildOwnerArticlePasswordStorageKeys } from "@/utils/protected-content";
import {
    type PendingUpload,
    csvToArray,
    decryptArticleBodyWithPassword,
    encryptArticleBody,
    extractUploadFileId,
    getApiMessage,
    isProtectedContentBody,
    isWrongProtectedPasswordError,
    resolveProtectedArticleMarkdown,
    toNullableString,
    toRecord,
    toStringValue,
} from "@/scripts/publish-page-helpers";
import type { PublishDomRefs } from "@/scripts/publish-page-dom";

// ── 运行时状态类型（从 publish-page.ts 重导出，避免循环） ──

export type PublishState = {
    currentItemId: string;
    currentItemShortId: string;
    currentStatus: "draft" | "published" | "archived" | "";
    currentCoverFileId: string;
    currentUsername: string;
    isLoggedIn: boolean;
    previewError: string;
    previewHtml: string;
    previewSource: string;
    previewDirty: boolean;
    renderedPreviewHtml: string;
    previewGeneration: number;
    previewFastTimer: number | null;
    previewFullTimer: number | null;
    initializedAfterLogin: boolean;
    loadedEncryptedBody: string;
    loadedEncryptedBodyUnlocked: boolean;
    inlineImageCounter: number;
};

export type UiHelpers = {
    setSubmitError: (message: string) => void;
    setSubmitMessage: (message: string) => void;
    setCoverMessage: (message: string) => void;
    updateEncryptHint: () => void;
    updateEncryptPanel: () => void;
    updateTitleHint: () => void;
    updateEditorHeader: () => void;
    updateSettingsActions: () => void;
    updateUrlState: () => void;
    updateCoverPreview: (pendingUploads: Map<string, PendingUpload>) => void;
};

// ── 常量 ──

const TITLE_TOO_LONG_MESSAGE = tFmt(I18nKey.articleEditorTitleMaxLength, {
    max: ARTICLE_TITLE_MAX,
});

// ── 密码收集 ──

export function collectSavedPasswords(item: Record<string, unknown>): string[] {
    const keys = buildOwnerArticlePasswordStorageKeys({
        id: toStringValue(item.id),
        shortId: toStringValue(item.short_id),
        slug: toStringValue(item.slug),
    });
    const candidatePaths = new Set<string>();
    const shortId = toStringValue(item.short_id);
    const slug = toStringValue(item.slug);
    if (slug) {
        candidatePaths.add(`/posts/${slug}`);
        candidatePaths.add(`/posts/${encodeURIComponent(slug)}`);
    }
    if (shortId) {
        candidatePaths.add(`/posts/${shortId}`);
        candidatePaths.add(`/posts/${encodeURIComponent(shortId)}`);
    }
    const passwords = new Set<string>();
    try {
        for (const key of keys) {
            const value = toStringValue(sessionStorage.getItem(key));
            if (value) {
                passwords.add(value);
            }
        }
    } catch (error) {
        console.warn("[publish] read owner password failed:", error);
    }
    try {
        for (const path of candidatePaths) {
            const value = toStringValue(
                sessionStorage.getItem(`page-password-${path}`),
            );
            if (value) {
                passwords.add(value);
            }
        }
    } catch (error) {
        console.warn("[publish] read session password failed:", error);
    }
    return Array.from(passwords);
}

// ── 加密 Body 填充 ──

export async function fillEncryptedBody(
    dom: PublishDomRefs,
    state: PublishState,
    rawBodyMarkdown: string,
    item: Record<string, unknown>,
    defaultBodyPlaceholder: string,
): Promise<boolean> {
    state.loadedEncryptedBody = rawBodyMarkdown;
    state.loadedEncryptedBodyUnlocked = false;
    dom.articleEncryptEnabledInput.checked = true;
    dom.articleBodyInput.value = "";
    const passwordCandidates = collectSavedPasswords(item);
    let unlockedEncryptedBody = false;
    for (const password of passwordCandidates) {
        try {
            const rawPlaintext = await decryptArticleBodyWithPassword(
                rawBodyMarkdown,
                password,
            );
            const resolved = resolveProtectedArticleMarkdown(rawPlaintext);
            dom.articleBodyInput.value = resolved.markdown;
            dom.articleBodyInput.placeholder = defaultBodyPlaceholder;
            if (!toStringValue(dom.articleEncryptPasswordInput.value)) {
                dom.articleEncryptPasswordInput.value = password;
            }
            unlockedEncryptedBody = true;
            state.loadedEncryptedBodyUnlocked = true;
            break;
        } catch (error) {
            if (isWrongProtectedPasswordError(error)) {
                continue;
            }
            console.warn("[publish] decrypt encrypted article failed:", error);
            break;
        }
    }
    if (!unlockedEncryptedBody) {
        dom.articleBodyInput.value = "";
        dom.articleBodyInput.placeholder = t(
            I18nKey.articleEditorEncryptedBodyLockedPlaceholder,
        );
        dom.articleEncryptPasswordInput.value = "";
    }
    return unlockedEncryptedBody;
}

// ── Body 加密与上传物化 ──

export async function materializePendingUploads(
    pendingUploads: Map<string, PendingUpload>,
    bodyMarkdown: string,
    state: PublishState,
    saveOverlay: SaveProgressOverlay,
): Promise<{ body: string; coverFileId: string | null }> {
    const entries = Array.from(pendingUploads.entries());
    if (entries.length === 0) {
        return { body: bodyMarkdown, coverFileId: null };
    }

    let nextBody = bodyMarkdown;
    let coverFileId: string | null = null;
    const total = entries.length;

    for (let i = 0; i < entries.length; i++) {
        const [localUrl, pending] = entries[i];
        const progressPercent = ((i + 1) / (total + 1)) * 80;
        saveOverlay.update(
            progressPercent,
            tFmt(I18nKey.articleEditorUploadProgress, {
                current: i + 1,
                total,
            }),
        );

        const formData = new FormData();
        formData.set("file", pending.file, pending.fileName);
        formData.set(
            "purpose",
            pending.purpose === "cover" ? "article-cover" : "general",
        );
        formData.set(
            "title",
            `${state.currentUsername || "user"}-${pending.fileName}`,
        );

        const { response, data } = await api("/api/v1/uploads", {
            method: "POST",
            body: formData,
        });

        if (response.status === 401) {
            throw new Error(t(I18nKey.articleEditorLoginExpired));
        }
        if (!response.ok || !data?.ok) {
            throw new Error(
                getApiMessage(
                    data,
                    tFmt(I18nKey.articleEditorUploadFileFailed, {
                        filename: pending.fileName,
                    }),
                ),
            );
        }

        const fileId = extractUploadFileId(data);
        if (!fileId) {
            throw new Error(
                tFmt(I18nKey.articleEditorUploadMissingFileId, {
                    filename: pending.fileName,
                }),
            );
        }

        if (pending.purpose === "cover") {
            coverFileId = fileId;
        } else {
            const remoteUrl = `/api/v1/assets/${encodeURIComponent(fileId)}`;
            nextBody = nextBody.split(localUrl).join(remoteUrl);
        }

        URL.revokeObjectURL(localUrl);
        pendingUploads.delete(localUrl);
    }

    return { body: nextBody, coverFileId };
}

export async function renderFullPreviewHtml(
    markdown: string,
    previewClient: MarkdownPreviewClient,
): Promise<string> {
    const result = await previewClient.preview(markdown, {
        mode: "full",
        force: true,
    });
    if (result.aborted) {
        throw new Error(t(I18nKey.articleEditorRenderInterruptedRetry));
    }
    if (result.unauthorized) {
        emitAuthState({
            isLoggedIn: false,
            isAdmin: false,
            userId: "",
            username: "",
        });
        throw new Error(t(I18nKey.articleEditorLoginExpired));
    }
    if (result.error) {
        throw new Error(result.error);
    }
    const normalized = normalizeMarkdownPreviewHtml(result.html);
    if (!normalized) {
        throw new Error(t(I18nKey.articleEditorRenderEncryptedFailed));
    }
    return normalized;
}

export function persistOwnerPassword(
    password: string,
    item: Record<string, unknown> | null,
    state: PublishState,
): void {
    const cleanPassword = toStringValue(password);
    if (!cleanPassword) {
        return;
    }
    const keys = buildOwnerArticlePasswordStorageKeys({
        id: toStringValue(item?.id) || state.currentItemId,
        shortId: toStringValue(item?.short_id) || state.currentItemShortId,
        slug: toStringValue(item?.slug),
    });
    if (keys.length === 0) {
        return;
    }
    try {
        for (const key of keys) {
            sessionStorage.setItem(key, cleanPassword);
        }
    } catch (error) {
        console.warn("[publish] persist owner password failed:", error);
    }
}

// ── Payload 构建 ──

export function buildSubmitPayload(
    dom: PublishDomRefs,
    state: PublishState,
    nextBodyMarkdown: string,
    coverFileId: string | null,
    targetStatus: "draft" | "published",
): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        title: toStringValue(dom.articleTitleInput.value),
        summary: toNullableString(dom.articleSummaryInput.value),
        body_markdown: nextBodyMarkdown,
        cover_url: toNullableString(dom.articleCoverUrlInput.value),
        tags: csvToArray(dom.articleTagsInput.value),
        category: toNullableString(dom.articleCategoryInput.value),
        allow_comments: dom.articleAllowCommentsInput.checked,
        is_public: dom.articleIsPublicInput.checked,
        status: targetStatus,
    };

    if (coverFileId) {
        payload.cover_file = coverFileId;
    } else if (state.currentCoverFileId) {
        payload.cover_file = state.currentCoverFileId;
    } else {
        payload.cover_file = null;
    }

    return payload;
}

// ── 表单验证 ──

export function validateSubmitForm(
    dom: PublishDomRefs,
    state: PublishState,
    ui: UiHelpers,
    targetStatus: "draft" | "published",
): { valid: boolean; canReuseEncryptedBody: boolean } {
    const title = toStringValue(dom.articleTitleInput.value);
    const bodyMarkdown = String(dom.articleBodyInput.value || "").trim();
    const encryptEnabled = dom.articleEncryptEnabledInput.checked;
    const inputPassword = toStringValue(dom.articleEncryptPasswordInput.value);
    const canReuseEncryptedBody =
        encryptEnabled &&
        !bodyMarkdown &&
        Boolean(state.loadedEncryptedBody) &&
        !inputPassword;

    if (
        encryptEnabled &&
        !bodyMarkdown &&
        Boolean(state.loadedEncryptedBody) &&
        inputPassword
    ) {
        ui.setSubmitError(
            t(I18nKey.articleEditorBodyEmptyCannotChangePasswordOnly),
        );
        return { valid: false, canReuseEncryptedBody };
    }
    if (weightedCharLength(title) > ARTICLE_TITLE_MAX) {
        ui.setSubmitError(TITLE_TOO_LONG_MESSAGE);
        return { valid: false, canReuseEncryptedBody };
    }
    if (targetStatus !== "published") {
        return { valid: true, canReuseEncryptedBody };
    }
    if (!title || (!bodyMarkdown && !canReuseEncryptedBody)) {
        ui.setSubmitError(t(I18nKey.articleEditorTitleBodyRequired));
        return { valid: false, canReuseEncryptedBody };
    }

    return { valid: true, canReuseEncryptedBody };
}

// ── 提交后 API 响应处理 ──

export async function handleSubmitApiResponse(
    state: PublishState,
    ui: UiHelpers,
    fillForm: (item: Record<string, unknown>) => Promise<boolean>,
    ownerPasswordForStorage: string,
    data: Record<string, unknown> | null,
    options: SubmitOptions = {},
): Promise<void> {
    const item = toRecord(data?.item);
    const nextId = toStringValue(item?.id) || state.currentItemId;
    if (nextId) {
        state.currentItemId = nextId;
    }
    const nextShortId = toStringValue(item?.short_id);
    if (nextShortId) {
        state.currentItemShortId = nextShortId;
    }
    if (item) {
        await fillForm(item);
    }
    if (ownerPasswordForStorage) {
        persistOwnerPassword(ownerPasswordForStorage, item, state);
    }
    ui.updateEditorHeader();
    ui.updateUrlState();
    ui.setSubmitMessage(
        options.targetStatus === "draft"
            ? t(I18nKey.articleEditorLocalDraftSaved)
            : options.redirectOnSuccess === false
              ? t(I18nKey.interactionCommonSaveSuccess)
              : t(I18nKey.articleEditorPublished),
    );
    ui.setSubmitError("");

    if (
        options.redirectOnSuccess === false ||
        options.targetStatus === "draft"
    ) {
        return;
    }

    if (item) {
        const slug = toStringValue(item.slug);
        const shortId = toStringValue(item.short_id);
        if (slug) {
            window.location.href = `/posts/${encodeURIComponent(slug)}`;
            return;
        }
        if (shortId) {
            window.location.href = `/posts/${encodeURIComponent(shortId)}`;
        }
    }
}

// ── Body 最终构建 ──

async function buildNextBodyMarkdown(
    canReuseEncryptedBody: boolean,
    encryptEnabled: boolean,
    inputPassword: string,
    uploads: { body: string },
    state: PublishState,
    saveOverlay: SaveProgressOverlay,
    previewClient: MarkdownPreviewClient,
    targetStatus: "draft" | "published",
): Promise<string> {
    if (canReuseEncryptedBody) {
        return state.loadedEncryptedBody;
    }
    if (!encryptEnabled) {
        return uploads.body;
    }
    if (!String(uploads.body || "").trim() && targetStatus === "draft") {
        return uploads.body;
    }
    if (!inputPassword) {
        throw new Error(t(I18nKey.articleEditorEncryptEnabledPasswordRequired));
    }
    saveOverlay.update(90, t(I18nKey.articleEditorGeneratingEncryptedContent));
    const bodyHtml = await renderFullPreviewHtml(uploads.body, previewClient);
    return encryptArticleBody(uploads.body, bodyHtml, inputPassword);
}

// ── 主提交函数 ──

export type SubmitDeps = {
    dom: PublishDomRefs;
    state: PublishState;
    pendingUploads: Map<string, PendingUpload>;
    saveOverlay: SaveProgressOverlay;
    previewClient: MarkdownPreviewClient;
    ui: UiHelpers;
    fillForm: (item: Record<string, unknown>) => Promise<boolean>;
};

export type SubmitOptions = {
    redirectOnSuccess?: boolean;
    targetStatus?: "draft" | "published";
};

export async function submit(
    deps: SubmitDeps,
    options: SubmitOptions = {},
): Promise<boolean> {
    const {
        dom,
        state,
        pendingUploads,
        saveOverlay,
        previewClient,
        ui,
        fillForm,
    } = deps;
    if (!state.isLoggedIn) {
        showAuthRequiredDialog();
        return false;
    }

    ui.setSubmitError("");
    ui.setSubmitMessage("");

    const targetStatus = options.targetStatus ?? "published";
    const { valid, canReuseEncryptedBody } = validateSubmitForm(
        dom,
        state,
        ui,
        targetStatus,
    );
    if (!valid) {
        return false;
    }

    const bodyMarkdown = String(dom.articleBodyInput.value || "").trim();
    const encryptEnabled = dom.articleEncryptEnabledInput.checked;
    const inputPassword = toStringValue(dom.articleEncryptPasswordInput.value);

    const draftLabel =
        dom.saveDraftBtn.textContent || t(I18nKey.interactionCommonSave);
    const publishLabel =
        dom.savePublishedBtn.textContent ||
        t(I18nKey.interactionCommonPublishNow);
    const discardDraftLabel =
        dom.discardDraftBtn.textContent || t(I18nKey.interactionCommonDelete);
    dom.saveDraftBtn.disabled = true;
    dom.savePublishedBtn.disabled = true;
    dom.discardDraftBtn.disabled = true;
    saveOverlay.show(t(I18nKey.articleEditorSavingTitle));

    try {
        const uploads = await materializePendingUploads(
            pendingUploads,
            canReuseEncryptedBody ? "" : bodyMarkdown,
            state,
            saveOverlay,
        );

        saveOverlay.update(85, t(I18nKey.articleEditorSavingData));

        const nextBodyMarkdown = await buildNextBodyMarkdown(
            canReuseEncryptedBody,
            encryptEnabled,
            inputPassword,
            uploads,
            state,
            saveOverlay,
            previewClient,
            targetStatus,
        );

        const ownerPasswordForStorage = encryptEnabled ? inputPassword : "";
        const payload = buildSubmitPayload(
            dom,
            state,
            nextBodyMarkdown,
            uploads.coverFileId,
            targetStatus,
        );

        const isEditing = Boolean(state.currentItemId);
        const endpoint =
            targetStatus === "draft" && !isEditing
                ? "/api/v1/me/articles/working-draft"
                : isEditing
                  ? `/api/v1/me/articles/${encodeURIComponent(state.currentItemId)}`
                  : "/api/v1/me/articles";
        const method =
            targetStatus === "draft" && !isEditing
                ? "PUT"
                : isEditing
                  ? "PATCH"
                  : "POST";

        const { response, data } = await api(endpoint, {
            method,
            body: JSON.stringify(payload),
        });

        if (response.status === 401) {
            emitAuthState({
                isLoggedIn: false,
                isAdmin: false,
                userId: "",
                username: "",
            });
            showAuthRequiredDialog();
            return false;
        }
        if (!response.ok || !data?.ok) {
            ui.setSubmitError(
                getApiMessage(data, t(I18nKey.articleEditorSaveFailedRetry)),
            );
            return false;
        }

        saveOverlay.update(100, t(I18nKey.articleEditorSaveCompleted));
        await new Promise((resolve) => setTimeout(resolve, 300));

        await handleSubmitApiResponse(
            state,
            ui,
            fillForm,
            ownerPasswordForStorage,
            data,
            {
                ...options,
                targetStatus,
            },
        );
        return true;
    } catch (error) {
        console.error("[publish] submit failed:", error);
        const message =
            error instanceof Error
                ? error.message
                : t(I18nKey.articleEditorSaveFailedRetry);
        ui.setSubmitError(message);
        return false;
    } finally {
        saveOverlay.hide();
        dom.saveDraftBtn.disabled = false;
        dom.savePublishedBtn.disabled = false;
        dom.discardDraftBtn.disabled = false;
        dom.saveDraftBtn.textContent = draftLabel;
        dom.savePublishedBtn.textContent = publishLabel;
        dom.discardDraftBtn.textContent = discardDraftLabel;
    }
}

// ── isProtectedContentBody 重导出（供 publish-page.ts 使用） ──

export { isProtectedContentBody };
