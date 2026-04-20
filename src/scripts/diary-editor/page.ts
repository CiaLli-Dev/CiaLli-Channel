/* eslint-disable max-lines-per-function -- 文件与入口函数较长，按页面驱动与现有模块边界保留当前结构 */
import { UPLOAD_LIMIT_LABELS, UPLOAD_LIMITS } from "@/constants/upload-limits";
import I18nKey from "@/i18n/i18nKey";
import { t, tFmt } from "@/scripts/shared/i18n-runtime";
import { showOverlayDialog } from "@/scripts/shared/overlay-dialog";
import type { ProgressTaskHandle } from "@/scripts/shared/progress-overlay-manager";
import { setupUnsavedChangesGuard } from "@/scripts/shared/unsaved-changes-guard";
import { buildDiarySaveSuccessRedirectUrl } from "@/scripts/shared/editor-save-redirect";
import { setupPageInit } from "@/utils/page-init";
import {
    api,
    getApiMessage,
    toStringValue,
    toNullableString,
    toBooleanValue,
    toRecord,
    normalizeImageEntries,
    buildImageOrderItemFromEntry,
    type EditorMode,
    type InitOptions,
    type PendingDiaryUpload,
    type DiaryImageOrderItem,
} from "@/scripts/diary-editor/helpers";
import {
    renderImageOrderImpl,
    type RenderImageOrderContext,
} from "@/scripts/diary-editor/render";
import {
    executeSaveDiary,
    type SaveDiaryContext,
} from "@/scripts/diary-editor/save";

const MAX_DIARY_UPLOAD_COUNT = 9;
let disposeActiveDiaryEditorPage: (() => void) | null = null;
let activeDiaryEditorController: AbortController | null = null;

function buildDiaryDraftSnapshot(
    contentInput: HTMLTextAreaElement,
    allowCommentsInput: HTMLInputElement,
    isPublicInput: HTMLInputElement,
    imageOrderItems: DiaryImageOrderItem[],
    pendingUploads: Map<string, PendingDiaryUpload>,
    deletedExistingImageIds: Set<string>,
): string {
    // 统一快照比较，覆盖文本、开关、图片顺序/待上传/待删除等编辑状态。
    const imageOrder = imageOrderItems.map((item) => ({
        key: item.key,
        kind: item.kind,
        caption: item.caption || "",
        imageId: item.imageId || "",
        localUrl: item.localUrl || "",
    }));
    return JSON.stringify({
        content: String(contentInput.value || ""),
        allowComments: allowCommentsInput.checked,
        isPublic: isPublicInput.checked,
        imageOrder,
        pendingUploadKeys: Array.from(pendingUploads.keys()).sort(),
        deletedImageIds: Array.from(deletedExistingImageIds).sort(),
    });
}

// ---- DOM refs type ----
type EditorDomRefs = {
    allowCommentsInput: HTMLInputElement;
    isPublicInput: HTMLInputElement;
    contentInput: HTMLTextAreaElement;
    saveDraftBtn: HTMLButtonElement | null;
    savePublishedBtn: HTMLButtonElement;
    submitMsgEl: HTMLElement;
    submitErrorEl: HTMLElement;
    uploadBtn: HTMLButtonElement;
    uploadFileInput: HTMLInputElement;
    uploadMsgEl: HTMLElement;
    imageOrderListEl: HTMLElement;
    imageOrderEmptyEl: HTMLElement;
};

function resolveEditorDomRefs(): EditorDomRefs | null {
    const allowCommentsInput = document.getElementById(
        "diary-editor-allow-comments",
    ) as HTMLInputElement | null;
    const isPublicInput = document.getElementById(
        "diary-editor-is-public",
    ) as HTMLInputElement | null;
    const contentInput = document.getElementById(
        "diary-editor-content",
    ) as HTMLTextAreaElement | null;
    const savePublishedBtn = document.getElementById(
        "diary-editor-save-published",
    ) as HTMLButtonElement | null;
    const saveDraftBtn = document.getElementById(
        "diary-editor-save-draft",
    ) as HTMLButtonElement | null;
    const submitMsgEl = document.getElementById("diary-editor-submit-msg");
    const submitErrorEl = document.getElementById("diary-editor-submit-error");
    const uploadBtn = document.getElementById(
        "diary-editor-upload-image",
    ) as HTMLButtonElement | null;
    const uploadFileInput = document.getElementById(
        "diary-editor-image-file",
    ) as HTMLInputElement | null;
    const uploadMsgEl = document.getElementById("diary-editor-upload-msg");
    const imageOrderListEl = document.getElementById(
        "diary-editor-image-order-list",
    );
    const imageOrderEmptyEl = document.getElementById(
        "diary-editor-image-order-empty",
    );
    if (
        !allowCommentsInput ||
        !isPublicInput ||
        !contentInput ||
        !savePublishedBtn ||
        !submitMsgEl ||
        !submitErrorEl ||
        !uploadBtn ||
        !uploadFileInput ||
        !uploadMsgEl ||
        !imageOrderListEl ||
        !imageOrderEmptyEl
    ) {
        return null;
    }
    return {
        allowCommentsInput,
        isPublicInput,
        contentInput,
        saveDraftBtn,
        savePublishedBtn,
        submitMsgEl,
        submitErrorEl,
        uploadBtn,
        uploadFileInput,
        uploadMsgEl,
        imageOrderListEl,
        imageOrderEmptyEl,
    };
}

function makeSetSubmitMessage(
    submitMsgEl: HTMLElement,
): (message: string) => void {
    return (message: string): void => {
        submitMsgEl.textContent = message;
    };
}

function makeSetSubmitError(
    submitErrorEl: HTMLElement,
): (message: string) => void {
    return (message: string): void => {
        if (!message) {
            submitErrorEl.textContent = "";
            submitErrorEl.classList.add("hidden");
            return;
        }
        submitErrorEl.textContent = message;
        submitErrorEl.classList.remove("hidden");
    };
}

function makeSetUploadMessage(
    uploadMsgEl: HTMLElement,
): (message: string, isError?: boolean) => void {
    return (message: string, isError = false): void => {
        uploadMsgEl.textContent = message;
        uploadMsgEl.classList.toggle("text-red-500", isError);
        uploadMsgEl.classList.toggle("text-60", !isError);
    };
}

function stageImage(
    file: File,
    uploadFileInput: HTMLInputElement,
    pendingUploads: Map<string, PendingDiaryUpload>,
    getImageOrderItems: () => DiaryImageOrderItem[],
    setImageOrderItems: (items: DiaryImageOrderItem[]) => void,
    renderImageOrder: () => void,
    setUploadMessage: (msg: string, isError?: boolean) => void,
): void {
    const currentItems = getImageOrderItems();
    if (currentItems.length >= MAX_DIARY_UPLOAD_COUNT) {
        setUploadMessage(
            tFmt(I18nKey.diaryEditorImageCountLimit, {
                max: MAX_DIARY_UPLOAD_COUNT,
            }),
            true,
        );
        uploadFileInput.value = "";
        return;
    }

    if (file.size > UPLOAD_LIMITS["diary-image"]) {
        setUploadMessage(
            tFmt(I18nKey.diaryEditorImageTooLarge, {
                limit: UPLOAD_LIMIT_LABELS["diary-image"],
            }),
            true,
        );
        return;
    }

    const localUrl = URL.createObjectURL(file);
    pendingUploads.set(localUrl, { file, localUrl });
    setImageOrderItems([
        ...currentItems,
        {
            key: `pending:${localUrl}`,
            kind: "pending",
            label:
                file.name ||
                tFmt(I18nKey.diaryEditorImageLabel, {
                    index: currentItems.length + 1,
                }),
            caption: file.name || undefined,
            previewUrl: localUrl,
            thumbUrl: localUrl,
            localUrl,
        },
    ]);
    renderImageOrder();
    setUploadMessage(t(I18nKey.diaryEditorStagedUpload));
    uploadFileInput.value = "";
}

function loadDiarySnapshot(
    refs: EditorDomRefs,
    item: Record<string, unknown>,
    imagesPayload: unknown,
    setImageOrderItems: (items: DiaryImageOrderItem[]) => void,
    setCurrentDiaryId: (id: string) => void,
    setCurrentDiaryStatus: (status: "draft" | "published" | "") => void,
    renderImageOrder: () => void,
    setSubmitMessage: (msg: string) => void,
): void {
    refs.allowCommentsInput.checked = toBooleanValue(item.allow_comments, true);
    refs.isPublicInput.checked = toBooleanValue(item.praviate, true);
    refs.contentInput.value = toStringValue(toNullableString(item.content));
    setCurrentDiaryId(toStringValue(item.id));
    const status = toStringValue(item.status);
    setCurrentDiaryStatus(
        status === "draft" || status === "published" ? status : "",
    );

    const nextOrderItems: DiaryImageOrderItem[] = [];
    normalizeImageEntries(imagesPayload).forEach((image, index) => {
        const orderItem = buildImageOrderItemFromEntry(image, index);
        if (orderItem) {
            nextOrderItems.push(orderItem);
        }
    });
    setImageOrderItems(nextOrderItems);
    renderImageOrder();
    setSubmitMessage(t(I18nKey.diaryEditorLoadedReadyEdit));
}

async function loadDiaryDetail(
    id: string,
    refs: EditorDomRefs,
    setImageOrderItems: (items: DiaryImageOrderItem[]) => void,
    setCurrentDiaryId: (id: string) => void,
    setCurrentDiaryStatus: (status: "draft" | "published" | "") => void,
    renderImageOrder: () => void,
    setSubmitMessage: (msg: string) => void,
    setSubmitError: (msg: string) => void,
): Promise<void> {
    const targetId = toStringValue(id);
    if (!targetId) {
        setSubmitError(t(I18nKey.diaryEditorMissingDiaryId));
        return;
    }
    setSubmitMessage(t(I18nKey.diaryEditorLoadingDiary));
    setSubmitError("");
    try {
        const { response, data } = await api(
            `/api/v1/me/diaries/${encodeURIComponent(targetId)}`,
            { method: "GET" },
        );
        if (!response.ok || !data?.ok) {
            setSubmitError(
                getApiMessage(data, t(I18nKey.diaryEditorLoadDiaryFailed)),
            );
            setSubmitMessage("");
            return;
        }
        const item = toRecord(data.item);
        if (!item) {
            setSubmitError(t(I18nKey.diaryEditorEditableDiaryNotFound));
            setSubmitMessage("");
            return;
        }
        loadDiarySnapshot(
            refs,
            item,
            data.images,
            setImageOrderItems,
            setCurrentDiaryId,
            setCurrentDiaryStatus,
            renderImageOrder,
            setSubmitMessage,
        );
    } catch (error) {
        console.error("[diary-editor] load detail failed:", error);
        setSubmitError(t(I18nKey.diaryEditorLoadDiaryFailedRetry));
        setSubmitMessage("");
    }
}

export function initDiaryEditorPage(options: InitOptions): boolean {
    const root = document.getElementById("diary-editor-root");
    if (!root) {
        return false;
    }
    if (root.dataset.diaryEditorBound === "1") {
        return true;
    }

    const refs = resolveEditorDomRefs();
    if (!refs) {
        return false;
    }
    // 仅在关键节点全部就绪后标记已绑定，避免过早短路导致页面无响应。
    root.dataset.diaryEditorBound = "1";
    // 页面重复进入前释放上一次编辑实例，避免残留监听器干扰导航确认。
    disposeActiveDiaryEditorPage?.();
    activeDiaryEditorController?.abort();
    const pageController = new AbortController();
    activeDiaryEditorController = pageController;

    const {
        allowCommentsInput,
        isPublicInput,
        contentInput,
        saveDraftBtn,
        savePublishedBtn,
        submitMsgEl,
        submitErrorEl,
        uploadBtn,
        uploadFileInput,
        uploadMsgEl,
        imageOrderListEl,
        imageOrderEmptyEl,
    } = refs;

    const editorMode: EditorMode = options.mode;
    const username = toStringValue(options.username);
    const publishButtonIdleText =
        editorMode === "edit"
            ? t(I18nKey.interactionCommonSaveChanges)
            : t(I18nKey.interactionCommonPublishNow);
    const publishButtonLoadingText =
        editorMode === "edit"
            ? t(I18nKey.diaryEditorSaving)
            : t(I18nKey.diaryEditorPublishing);
    const draftButtonIdleText = t(I18nKey.interactionCommonSaveDraft);
    const draftButtonLoadingText = t(I18nKey.diaryEditorSaving);
    let currentDiaryId = toStringValue(options.diaryId ?? root.dataset.diaryId);
    let currentDiaryStatus: "draft" | "published" | "" = "";

    const pendingUploads = new Map<string, PendingDiaryUpload>();
    let imageOrderItems: DiaryImageOrderItem[] = [];
    let dragIndex: number | null = null;
    const deletedExistingImageIds = new Set<string>();
    let isSaving = false;
    let saveTaskHandle: ProgressTaskHandle | null = null;
    let savedDraftSnapshot = "";

    const setSubmitMessage = makeSetSubmitMessage(submitMsgEl);
    const setSubmitError = makeSetSubmitError(submitErrorEl);
    const setUploadMessage = makeSetUploadMessage(uploadMsgEl);

    const setSavingState = (nextSaving: boolean): void => {
        isSaving = nextSaving;
        if (saveDraftBtn) {
            saveDraftBtn.disabled = nextSaving;
            saveDraftBtn.textContent = nextSaving
                ? draftButtonLoadingText
                : draftButtonIdleText;
        }
        savePublishedBtn.disabled = nextSaving;
        savePublishedBtn.textContent = nextSaving
            ? publishButtonLoadingText
            : publishButtonIdleText;
    };
    const markDraftSaved = (): void => {
        savedDraftSnapshot = buildDiaryDraftSnapshot(
            contentInput,
            allowCommentsInput,
            isPublicInput,
            imageOrderItems,
            pendingUploads,
            deletedExistingImageIds,
        );
    };
    const hasUnsavedDraftChanges = (): boolean => {
        if (isSaving) {
            return false;
        }
        return (
            buildDiaryDraftSnapshot(
                contentInput,
                allowCommentsInput,
                isPublicInput,
                imageOrderItems,
                pendingUploads,
                deletedExistingImageIds,
            ) !== savedDraftSnapshot
        );
    };

    const renderCtx: RenderImageOrderContext = {
        imageOrderListEl,
        imageOrderEmptyEl,
        getImageOrderItems: () => imageOrderItems,
        setImageOrderItems: (items) => {
            imageOrderItems = items;
        },
        getDragIndex: () => dragIndex,
        setDragIndex: (index) => {
            dragIndex = index;
        },
        isSaving: () => isSaving,
        pendingUploads,
        deletedExistingImageIds,
        setUploadMessage,
        setSubmitMessage,
        renderImageOrder: () => renderImageOrderImpl(renderCtx),
    };

    const renderImageOrder = (): void => renderImageOrderImpl(renderCtx);

    const saveDiaryCtx: SaveDiaryContext = {
        editorMode,
        contentInput,
        allowCommentsInput,
        isPublicInput,
        saveDraftBtn,
        savePublishedBtn,
        publishButtonIdleText,
        publishButtonLoadingText,
        draftButtonIdleText,
        draftButtonLoadingText,
        username,
        getCurrentDiaryId: () => currentDiaryId,
        setCurrentDiaryId: (id) => {
            currentDiaryId = id;
        },
        getCurrentStatus: () => currentDiaryStatus,
        setCurrentStatus: (status) => {
            currentDiaryStatus = status;
        },
        pendingUploads,
        getImageOrderItems: () => imageOrderItems,
        deletedExistingImageIds,
        getSaveTaskHandle: () => saveTaskHandle,
        setSaveTaskHandle: (handle) => {
            saveTaskHandle = handle;
        },
        setSubmitMessage,
        setSubmitError,
        setUploadMessage,
        setSavingState,
        markDraftSaved,
    };

    savePublishedBtn.addEventListener("click", () => {
        void executeSaveDiary(saveDiaryCtx, {
            targetStatus: "published",
        });
    });
    saveDraftBtn?.addEventListener("click", () => {
        void executeSaveDiary(saveDiaryCtx, {
            successRedirectUrl: buildDiarySaveSuccessRedirectUrl(username),
            targetStatus: "draft",
        });
    });

    contentInput.addEventListener("input", () => {
        setSubmitMessage("");
        setSubmitError("");
    });

    uploadBtn.addEventListener("click", () => {
        uploadFileInput.click();
    });

    uploadFileInput.addEventListener("change", () => {
        const file = uploadFileInput.files?.[0];
        if (!file) {
            return;
        }
        stageImage(
            file,
            uploadFileInput,
            pendingUploads,
            () => imageOrderItems,
            (items) => {
                imageOrderItems = items;
            },
            renderImageOrder,
            setUploadMessage,
        );
    });

    if (editorMode === "edit") {
        void loadDiaryDetail(
            currentDiaryId,
            refs,
            (items) => {
                imageOrderItems = items;
            },
            (id) => {
                currentDiaryId = id;
            },
            (status) => {
                currentDiaryStatus = status;
            },
            renderImageOrder,
            setSubmitMessage,
            setSubmitError,
        ).finally(() => {
            markDraftSaved();
        });
    } else {
        void (async () => {
            renderImageOrder();
            try {
                const { response, data } = await api(
                    "/api/v1/me/diaries/working-draft",
                    { method: "GET" },
                );
                if (!response.ok || !data?.ok) {
                    markDraftSaved();
                    return;
                }
                const item = toRecord(data.item);
                if (!item) {
                    markDraftSaved();
                    return;
                }
                const decision = await showOverlayDialog({
                    ariaLabel: t(I18nKey.diaryEditorWorkingDraftDetectedTitle),
                    message: t(I18nKey.diaryEditorWorkingDraftDetectedMessage),
                    dismissKey: null,
                    actions: [
                        {
                            key: "resume",
                            label: t(I18nKey.diaryEditorWorkingDraftResume),
                            variant: "primary",
                        },
                        {
                            key: "delete",
                            label: t(
                                I18nKey.diaryEditorWorkingDraftDeleteAndCreate,
                            ),
                            variant: "danger",
                        },
                    ],
                });
                if (decision.actionKey === "resume") {
                    loadDiarySnapshot(
                        refs,
                        item,
                        data.images,
                        (items) => {
                            imageOrderItems = items;
                        },
                        (id) => {
                            currentDiaryId = id;
                        },
                        (status) => {
                            currentDiaryStatus = status;
                        },
                        renderImageOrder,
                        setSubmitMessage,
                    );
                    setSubmitMessage(
                        t(I18nKey.diaryEditorWorkingDraftRestored),
                    );
                    markDraftSaved();
                    return;
                }
                const draftId = toStringValue(item.id);
                if (draftId) {
                    const { response: deleteResponse, data: deleteData } =
                        await api(
                            `/api/v1/me/diaries/${encodeURIComponent(draftId)}`,
                            {
                                method: "DELETE",
                            },
                        );
                    if (!deleteResponse.ok || !deleteData?.ok) {
                        setSubmitError(
                            getApiMessage(
                                deleteData,
                                t(I18nKey.diaryEditorSaveFailedRetry),
                            ),
                        );
                        markDraftSaved();
                        return;
                    }
                }
                currentDiaryId = "";
                currentDiaryStatus = "";
                contentInput.value = "";
                allowCommentsInput.checked = true;
                isPublicInput.checked = true;
                imageOrderItems = [];
                deletedExistingImageIds.clear();
                renderImageOrder();
                setSubmitMessage(t(I18nKey.diaryEditorWorkingDraftDeleted));
            } catch (error) {
                console.error(
                    "[diary-editor] resolve working draft failed:",
                    error,
                );
            } finally {
                markDraftSaved();
            }
        })();
    }

    const disposeUnsavedGuard = setupUnsavedChangesGuard({
        isDirty: hasUnsavedDraftChanges,
        getConfirmMessage: () =>
            t(I18nKey.interactionCommonUnsavedChangesLeaveConfirm),
        saveBeforeLeave: () =>
            executeSaveDiary(saveDiaryCtx, {
                redirectOnSuccess: false,
                targetStatus:
                    editorMode === "edit" && currentDiaryStatus === "published"
                        ? "published"
                        : "draft",
            }),
    });
    let disposed = false;
    const disposeDiaryEditorResources = (): void => {
        if (disposed) {
            return;
        }
        disposed = true;
        if (disposeActiveDiaryEditorPage === disposeDiaryEditorResources) {
            disposeActiveDiaryEditorPage = null;
        }
        if (activeDiaryEditorController === pageController) {
            activeDiaryEditorController = null;
        }
        pageController.abort();
        disposeUnsavedGuard();
        for (const pending of pendingUploads.values()) {
            URL.revokeObjectURL(pending.localUrl);
        }
        pendingUploads.clear();
    };
    disposeActiveDiaryEditorPage = disposeDiaryEditorResources;
    document.addEventListener(
        "astro:before-swap",
        disposeDiaryEditorResources,
        {
            once: true,
            signal: pageController.signal,
        },
    );
    window.addEventListener("pagehide", disposeDiaryEditorResources, {
        once: true,
        signal: pageController.signal,
    });
    return true;
}

/**
 * 页面级初始化：兼容 Astro View Transitions 导航后的重复进入场景。
 */
export function bootstrapDiaryEditorPage(): void {
    setupPageInit({
        key: "diary-editor-page",
        init: () => {
            const root = document.getElementById("diary-editor-root");
            if (!(root instanceof HTMLElement)) {
                return;
            }

            const mode =
                String(root.dataset.mode || "").trim() === "edit"
                    ? "edit"
                    : "create";
            const username = String(root.dataset.username || "").trim();
            const diaryId = String(root.dataset.diaryId || "").trim();

            const initialized = initDiaryEditorPage({
                mode,
                username,
                diaryId: diaryId || undefined,
            });
            if (!initialized) {
                window.setTimeout(() => {
                    initDiaryEditorPage({
                        mode,
                        username,
                        diaryId: diaryId || undefined,
                    });
                }, 32);
            }
        },
        delay: 0,
        runOnPageShow: true,
        stages: ["page-load"],
    });
}
