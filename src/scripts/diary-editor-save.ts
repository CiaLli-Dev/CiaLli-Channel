import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    finishTask,
    startTask,
    updateTask,
    type ProgressTaskHandle,
} from "@/scripts/progress-overlay-manager";
import { navigateToPage } from "@/utils/navigation-utils";
import {
    api,
    getApiMessage,
    toRecord,
    toStringValue,
    materializePendingUploads,
    persistDiaryImages,
    type EditorMode,
    type MaterializedDiaryUpload,
    type DiaryImageOrderItem,
    type PendingDiaryUpload,
} from "@/scripts/diary-editor-helpers";

export type SaveDiaryContext = {
    editorMode: EditorMode;
    contentInput: HTMLTextAreaElement;
    allowCommentsInput: HTMLInputElement;
    isPublicInput: HTMLInputElement;
    saveDraftBtn: HTMLButtonElement | null;
    savePublishedBtn: HTMLButtonElement;
    publishButtonIdleText: string;
    publishButtonLoadingText: string;
    draftButtonIdleText: string;
    draftButtonLoadingText: string;
    username: string;
    getCurrentDiaryId: () => string;
    setCurrentDiaryId: (id: string) => void;
    getCurrentStatus: () => "draft" | "published" | "";
    setCurrentStatus: (status: "draft" | "published") => void;
    pendingUploads: Map<string, PendingDiaryUpload>;
    getImageOrderItems: () => DiaryImageOrderItem[];
    deletedExistingImageIds: Set<string>;
    getSaveTaskHandle: () => ProgressTaskHandle | null;
    setSaveTaskHandle: (handle: ProgressTaskHandle | null) => void;
    setSubmitMessage: (message: string) => void;
    setSubmitError: (message: string) => void;
    setUploadMessage: (message: string, isError?: boolean) => void;
    setSavingState: (saving: boolean) => void;
    markDraftSaved: () => void;
};

export type ExecuteSaveDiaryOptions = {
    redirectOnSuccess?: boolean;
    targetStatus?: "draft" | "published";
};

async function saveDiaryContent(
    content: string,
    ctx: SaveDiaryContext,
    targetStatus: "draft" | "published",
): Promise<{ id: string; shortId: string } | null> {
    const payload = {
        content,
        allow_comments: ctx.allowCommentsInput.checked,
        praviate: ctx.isPublicInput.checked,
        status: targetStatus,
    };

    const currentDiaryId = ctx.getCurrentDiaryId();
    const isDraftSave = targetStatus === "draft";
    const endpoint = isDraftSave
        ? "/api/v1/me/diaries/working-draft"
        : currentDiaryId
          ? `/api/v1/me/diaries/${encodeURIComponent(currentDiaryId)}`
          : "/api/v1/me/diaries";
    const method = isDraftSave ? "PUT" : currentDiaryId ? "PATCH" : "POST";

    const { response, data } = await api(endpoint, {
        method,
        body: JSON.stringify(payload),
    });
    if (!response.ok || !data?.ok) {
        ctx.setSubmitError(
            getApiMessage(data, t(I18nKey.diaryEditorSaveFailed)),
        );
        ctx.setSubmitMessage("");
        return null;
    }

    const item = toRecord(data.item);
    const id = toStringValue(item?.id);
    const shortId = toStringValue(item?.short_id);
    if (!id) {
        ctx.setSubmitError(t(I18nKey.diaryEditorSaveMissingDiaryId));
        ctx.setSubmitMessage("");
        return null;
    }
    return { id, shortId };
}

async function syncImagesAfterSave(
    id: string,
    materializedUploads: MaterializedDiaryUpload[],
    ctx: SaveDiaryContext,
): Promise<void> {
    const taskHandle = ctx.getSaveTaskHandle();
    if (taskHandle !== null) {
        updateTask(taskHandle, {
            mode: "determinate",
            percent: 92,
            text: t(I18nKey.diaryEditorSyncingImageOrder),
        });
    }
    try {
        await persistDiaryImages(
            id,
            materializedUploads,
            ctx.getImageOrderItems(),
            ctx.deletedExistingImageIds,
            ctx.isPublicInput.checked,
        );
    } catch (error) {
        console.error("[diary-editor] persist diary images failed:", error);
        const message =
            error instanceof Error && error.message
                ? error.message
                : t(I18nKey.diaryEditorPartialImageSyncFailed);
        ctx.setUploadMessage(message, true);
    }
}

function startSaveTask(
    ctx: SaveDiaryContext,
    targetStatus: "draft" | "published",
): ProgressTaskHandle {
    const pendingCount = ctx.pendingUploads.size;
    return startTask({
        title:
            targetStatus === "draft"
                ? t(I18nKey.diaryEditorSavingTitle)
                : ctx.editorMode === "edit"
                  ? t(I18nKey.diaryEditorSavingTitle)
                  : t(I18nKey.diaryEditorPublishingTitle),
        mode: pendingCount > 0 ? "determinate" : "indeterminate",
        percent: 0,
        text:
            pendingCount > 0
                ? t(I18nKey.diaryEditorPreparingUpload)
                : t(I18nKey.diaryEditorSubmittingDiary),
    });
}

function handleSaveError(
    error: unknown,
    uploadStageFailed: boolean,
    ctx: SaveDiaryContext,
): void {
    console.error("[diary-editor] save failed:", error);
    const message =
        error instanceof Error && error.message
            ? error.message
            : t(I18nKey.diaryEditorSaveFailedRetry);
    if (uploadStageFailed) {
        ctx.setUploadMessage(message, true);
        ctx.setSubmitError(t(I18nKey.diaryEditorUploadFailedUnsaved));
        ctx.setSubmitMessage("");
        return;
    }
    ctx.setSubmitError(t(I18nKey.diaryEditorSaveFailedRetry));
    ctx.setSubmitMessage("");
}

async function runSaveDiaryCore(
    sourceContent: string,
    ctx: SaveDiaryContext,
    options: ExecuteSaveDiaryOptions,
): Promise<boolean> {
    let content = sourceContent.trim();
    let uploadStageFailed = false;
    const targetStatus =
        options.targetStatus ||
        (ctx.getCurrentStatus() === "published" ? "published" : "draft");

    try {
        const materialized = await materializePendingUploads(
            content,
            ctx.pendingUploads,
            ctx.getSaveTaskHandle(),
        ).catch((error: unknown) => {
            uploadStageFailed = true;
            throw error;
        });
        content = materialized.content;
        const materializedUploads = materialized.uploads;

        const taskHandle = ctx.getSaveTaskHandle();
        if (taskHandle !== null) {
            updateTask(taskHandle, {
                mode: "determinate",
                percent: 85,
                text: t(I18nKey.diaryEditorSavingContent),
            });
        }

        if (content !== sourceContent.trim()) {
            ctx.contentInput.value = content;
        }

        const saveResult = await saveDiaryContent(content, ctx, targetStatus);
        if (!saveResult) {
            return false;
        }

        const { id, shortId } = saveResult;
        const targetId = shortId || id;
        if (!targetId) {
            ctx.setSubmitError(t(I18nKey.diaryEditorSaveMissingDiaryId));
            ctx.setSubmitMessage("");
            return false;
        }

        ctx.setCurrentDiaryId(id);
        ctx.setCurrentStatus(targetStatus);
        await syncImagesAfterSave(id, materializedUploads, ctx);
        ctx.markDraftSaved();

        const finalHandle = ctx.getSaveTaskHandle();
        if (finalHandle !== null) {
            updateTask(finalHandle, {
                mode: "determinate",
                percent: 100,
                text: t(I18nKey.diaryEditorSaveCompleted),
            });
        }

        if (options.redirectOnSuccess === false) {
            ctx.setSubmitMessage(t(I18nKey.interactionCommonSaveSuccess));
        } else {
            ctx.setSubmitMessage(
                targetStatus === "draft"
                    ? t(I18nKey.interactionCommonSaveSuccess)
                    : ctx.editorMode === "edit"
                      ? t(I18nKey.diaryEditorSaveSuccessRedirecting)
                      : t(I18nKey.diaryEditorPublishSuccessRedirecting),
            );
            if (targetStatus === "published") {
                navigateToPage(
                    `/${ctx.username}/diary/${encodeURIComponent(targetId)}`,
                    { force: true },
                );
            }
        }
        return true;
    } catch (error) {
        handleSaveError(error, uploadStageFailed, ctx);
        return false;
    } finally {
        ctx.setSavingState(false);
        const finalHandle = ctx.getSaveTaskHandle();
        if (finalHandle !== null) {
            finishTask(finalHandle);
            ctx.setSaveTaskHandle(null);
        }
    }
}

export async function executeSaveDiary(
    ctx: SaveDiaryContext,
    options: ExecuteSaveDiaryOptions = {},
): Promise<boolean> {
    const sourceContent = String(ctx.contentInput.value || "");
    const targetStatus =
        options.targetStatus ||
        (ctx.getCurrentStatus() === "published" ? "published" : "draft");
    if (targetStatus === "published" && !sourceContent.trim()) {
        ctx.setSubmitError(t(I18nKey.diaryEditorContentRequired));
        return false;
    }

    const taskHandle = startSaveTask(ctx, targetStatus);
    ctx.setSaveTaskHandle(taskHandle);

    ctx.setSubmitError("");
    ctx.setSubmitMessage(
        targetStatus === "draft"
            ? t(I18nKey.diaryEditorSaving)
            : ctx.editorMode === "edit"
              ? t(I18nKey.diaryEditorSaving)
              : t(I18nKey.diaryEditorPublishing),
    );
    ctx.setSavingState(true);

    return runSaveDiaryCore(sourceContent, ctx, {
        ...options,
        targetStatus,
    });
}
