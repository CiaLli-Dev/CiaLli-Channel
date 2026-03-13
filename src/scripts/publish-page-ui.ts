/**
 * 发布页面 UI 辅助函数
 *
 * 封装与 DOM 状态同步的各类 UI 更新方法。
 */

import { ARTICLE_TITLE_MAX, weightedCharLength } from "@/constants/text-limits";
import I18nKey from "@/i18n/i18nKey";
import { t, tFmt } from "@/scripts/i18n-runtime";
import {
    type PendingUpload,
    buildDirectusAssetPreview,
    toStringValue,
} from "@/scripts/publish-page-helpers";
import type { PublishDomRefs } from "@/scripts/publish-page-dom";
import type { PublishState, UiHelpers } from "@/scripts/publish-page-submit";

export const TITLE_TOO_LONG_MESSAGE = tFmt(
    I18nKey.articleEditorTitleMaxLength,
    {
        max: ARTICLE_TITLE_MAX,
    },
);
export const DEFAULT_BODY_PLACEHOLDER = t(I18nKey.articleEditorBodyPlaceholder);
const EXISTING_ENCRYPT_HINT = t(I18nKey.articleEditorEncryptHintExisting);

export function makeUiHelpers(
    dom: PublishDomRefs,
    state: PublishState,
): UiHelpers {
    const setSubmitError = (message: string): void => {
        if (!message) {
            dom.submitErrorEl.textContent = "";
            dom.submitErrorEl.classList.add("hidden");
            return;
        }
        dom.submitErrorEl.textContent = message;
        dom.submitErrorEl.classList.remove("hidden");
    };

    const setSubmitMessage = (message: string): void => {
        dom.submitMsgEl.textContent = message;
    };

    const setCoverMessage = (message: string): void => {
        if (dom.coverMsgEl) {
            dom.coverMsgEl.textContent = message;
        }
    };

    const updateEncryptHint = (): void => {
        if (!dom.articleEncryptHintEl) {
            return;
        }
        if (!dom.articleEncryptEnabledInput.checked) {
            dom.articleEncryptHintEl.textContent = "";
            return;
        }
        if (state.loadedEncryptedBody && !state.loadedEncryptedBodyUnlocked) {
            dom.articleEncryptHintEl.textContent = t(
                I18nKey.articleEditorEncryptHintLocked,
            );
            return;
        }
        if (
            state.loadedEncryptedBody &&
            !String(dom.articleBodyInput.value || "").trim()
        ) {
            dom.articleEncryptHintEl.textContent = EXISTING_ENCRYPT_HINT;
            return;
        }
        dom.articleEncryptHintEl.textContent = "";
    };

    const updateEncryptPanel = (): void => {
        const enabled = dom.articleEncryptEnabledInput.checked;
        dom.articleEncryptPanelEl.classList.toggle("hidden", !enabled);
        if (!enabled) {
            dom.articleEncryptPasswordInput.value = "";
        }
        updateEncryptHint();
    };

    const updateTitleHint = (): void => {
        if (!dom.articleTitleHintEl) {
            return;
        }
        const current = weightedCharLength(
            String(dom.articleTitleInput.value || ""),
        );
        dom.articleTitleHintEl.textContent = `${current}/${ARTICLE_TITLE_MAX}`;
        dom.articleTitleHintEl.classList.toggle(
            "text-red-500",
            current > ARTICLE_TITLE_MAX,
        );
        dom.articleTitleHintEl.classList.toggle(
            "text-60",
            current <= ARTICLE_TITLE_MAX,
        );
    };

    const updateEditorHeader = (): void => {
        if (state.currentItemId) {
            dom.editorTitleEl.textContent = t(
                I18nKey.articleEditorEditorTitleEdit,
            );
            if (dom.currentHintEl) {
                dom.currentHintEl.textContent = t(
                    I18nKey.articleEditorEditorHintEdit,
                );
            }
            updateSettingsActions();
            return;
        }
        dom.editorTitleEl.textContent = t(
            I18nKey.articleEditorEditorTitleCreate,
        );
        if (dom.currentHintEl) {
            dom.currentHintEl.textContent = t(
                I18nKey.articleEditorEditorHintCreate,
            );
        }
        updateSettingsActions();
    };

    const updateSettingsActions = (): void => {
        const isPublishedEdit =
            Boolean(state.currentItemId) && state.currentStatus === "published";
        const isDraftEdit =
            Boolean(state.currentItemId) && state.currentStatus === "draft";

        if (dom.openSettingsBtn) {
            dom.openSettingsBtn.textContent = t(
                isPublishedEdit
                    ? I18nKey.interactionCommonSaveChanges
                    : I18nKey.interactionCommonPublishNow,
            );
        }
        dom.saveDraftBtn.classList.toggle("hidden", isPublishedEdit);
        dom.discardDraftBtn.classList.toggle("hidden", !isDraftEdit);
        dom.saveDraftBtn.textContent = t(I18nKey.interactionCommonSaveDraft);
        dom.discardDraftBtn.textContent = t(
            I18nKey.interactionCommonDiscardDraft,
        );
        dom.savePublishedBtn.textContent = t(
            isPublishedEdit
                ? I18nKey.interactionCommonSaveChanges
                : I18nKey.interactionCommonPublishNow,
        );
    };

    const updateUrlState = (): void => {
        if (state.currentItemShortId) {
            const nextUrl = `/posts/${encodeURIComponent(state.currentItemShortId)}/edit`;
            window.history.replaceState(null, "", nextUrl);
        }
    };

    const updateCoverPreview = (
        pendingUploads: Map<string, PendingUpload>,
    ): void => {
        if (!dom.coverPreviewWrapEl || !dom.coverPreviewEl) {
            return;
        }
        const pendingCover = Array.from(pendingUploads.values()).find(
            (p) => p.purpose === "cover",
        );
        if (pendingCover) {
            dom.coverPreviewEl.src = pendingCover.localUrl;
            dom.coverPreviewWrapEl.classList.remove("hidden");
            return;
        }
        if (state.currentCoverFileId) {
            dom.coverPreviewEl.src = buildDirectusAssetPreview(
                state.currentCoverFileId,
            );
            dom.coverPreviewWrapEl.classList.remove("hidden");
            return;
        }
        const externalUrl = toStringValue(dom.articleCoverUrlInput.value);
        if (externalUrl) {
            dom.coverPreviewEl.src = externalUrl;
            dom.coverPreviewWrapEl.classList.remove("hidden");
            return;
        }
        dom.coverPreviewWrapEl.classList.add("hidden");
        dom.coverPreviewEl.src = "";
    };

    return {
        setSubmitError,
        setSubmitMessage,
        setCoverMessage,
        updateEncryptHint,
        updateEncryptPanel,
        updateTitleHint,
        updateEditorHeader,
        updateSettingsActions,
        updateUrlState,
        updateCoverPreview,
    };
}
