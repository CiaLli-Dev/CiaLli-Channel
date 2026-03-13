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
    savePublishedBtn: HTMLButtonElement;
    publishButtonIdleText: string;
    publishButtonLoadingText: string;
    username: string;
    getCurrentDiaryId: () => string;
    setCurrentDiaryId: (id: string) => void;
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
};

async function saveDiaryContent(
    content: string,
    ctx: SaveDiaryContext,
): Promise<{ id: string; shortId: string } | null> {
    const payload = {
        content,
        allow_comments: ctx.allowCommentsInput.checked,
        praviate: ctx.isPublicInput.checked,
        status: "published",
    };

    const currentDiaryId = ctx.getCurrentDiaryId();
    const isCreate = !currentDiaryId;
    const endpoint = isCreate
        ? "/api/v1/me/diaries"
        : `/api/v1/me/diaries/${encodeURIComponent(currentDiaryId)}`;
    const method = isCreate ? "POST" : "PATCH";

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

function startSaveTask(ctx: SaveDiaryContext): ProgressTaskHandle {
    const pendingCount = ctx.pendingUploads.size;
    return startTask({
        title:
            ctx.editorMode === "edit"
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

        const saveResult = await saveDiaryContent(content, ctx);
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
                ctx.editorMode === "edit"
                    ? t(I18nKey.diaryEditorSaveSuccessRedirecting)
                    : t(I18nKey.diaryEditorPublishSuccessRedirecting),
            );
            navigateToPage(
                `/${ctx.username}/diary/${encodeURIComponent(targetId)}`,
                { force: true },
            );
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
    if (!sourceContent.trim()) {
        ctx.setSubmitError(t(I18nKey.diaryEditorContentRequired));
        return false;
    }

    const taskHandle = startSaveTask(ctx);
    ctx.setSaveTaskHandle(taskHandle);

    ctx.setSubmitError("");
    ctx.setSubmitMessage(
        ctx.editorMode === "edit"
            ? t(I18nKey.diaryEditorSaving)
            : t(I18nKey.diaryEditorPublishing),
    );
    ctx.setSavingState(true);

    return runSaveDiaryCore(sourceContent, ctx, options);
}
