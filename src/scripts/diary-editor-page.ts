import { UPLOAD_LIMIT_LABELS, UPLOAD_LIMITS } from "@/constants/upload-limits";
import I18nKey from "@/i18n/i18nKey";
import { showConfirmDialog } from "@/scripts/dialogs";
import { t, tFmt } from "@/scripts/i18n-runtime";
import {
    finishTask,
    startTask,
    updateTask,
    type ProgressTaskHandle,
} from "@/scripts/progress-overlay-manager";
import { setupPageInit } from "@/utils/page-init";
import { getCsrfToken } from "@/utils/csrf";
import { navigateToPage } from "@/utils/navigation-utils";

type EditorMode = "create" | "edit";

type InitOptions = {
    mode: EditorMode;
    username: string;
    diaryId?: string;
};

type ApiResult = {
    response: Response;
    data: Record<string, unknown> | null;
};

type DiaryItem = {
    id: string;
    short_id?: string | null;
    content?: string | null;
    allow_comments?: boolean;
    praviate?: boolean;
};

type PendingDiaryUpload = {
    file: File;
    localUrl: string;
};

type MaterializedDiaryUpload = {
    localUrl: string;
    fileId: string;
    remoteUrl: string;
};

type DiaryImageOrderItem = {
    key: string;
    kind: "existing" | "pending";
    label: string;
    caption?: string;
    previewUrl?: string;
    thumbUrl?: string;
    imageId?: string;
    localUrl?: string;
};

const MAX_DIARY_UPLOAD_COUNT = 9;

function normalizeApiUrl(url: string): string {
    if (!url.startsWith("/")) {
        return `/${url}`;
    }
    return url;
}

async function api(url: string, init: RequestInit): Promise<ApiResult> {
    const isFormData =
        typeof FormData !== "undefined" &&
        Boolean(init.body) &&
        init.body instanceof FormData;

    const response = await fetch(normalizeApiUrl(url), {
        credentials: "include",
        headers: {
            Accept: "application/json",
            "x-csrf-token": getCsrfToken(),
            ...(init.body && !isFormData
                ? { "Content-Type": "application/json" }
                : {}),
            ...((init.headers as Record<string, string>) || {}),
        },
        ...init,
    });
    const data = (await response.json().catch(() => null)) as Record<
        string,
        unknown
    > | null;
    return { response, data };
}

function toStringValue(value: unknown): string {
    return String(value ?? "").trim();
}

function toNullableString(value: unknown): string | null {
    const normalized = toStringValue(value);
    return normalized ? normalized : null;
}

function toBooleanValue(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    return fallback;
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function getApiMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    if (!data) {
        return fallback;
    }
    const message = toStringValue(data.message);
    if (message) {
        return message;
    }
    const error = toRecord(data.error);
    const errorMessage = toStringValue(error?.message);
    return errorMessage || fallback;
}

function getUploadedFileId(data: Record<string, unknown> | null): string {
    const file = toRecord(data?.file);
    const idFromFile = toStringValue(file?.id);
    if (idFromFile) {
        return idFromFile;
    }
    return toStringValue(data?.id);
}

export function initDiaryEditorPage(options: InitOptions): boolean {
    const root = document.getElementById("diary-editor-root");
    if (!root) {
        return false;
    }
    if (root.dataset.diaryEditorBound === "1") {
        return true;
    }

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
        return false;
    }
    // 仅在关键节点全部就绪后标记已绑定，避免过早短路导致页面无响应。
    root.dataset.diaryEditorBound = "1";

    const username = toStringValue(options.username);
    const editorMode = options.mode;
    const publishButtonIdleText =
        editorMode === "edit"
            ? t(I18nKey.commonSaveChanges)
            : t(I18nKey.commonPublishNow);
    const publishButtonLoadingText =
        editorMode === "edit"
            ? t(I18nKey.diaryEditorSaving)
            : t(I18nKey.diaryEditorPublishing);
    let currentDiaryId = toStringValue(options.diaryId || root.dataset.diaryId);

    const pendingUploads = new Map<string, PendingDiaryUpload>();
    let imageOrderItems: DiaryImageOrderItem[] = [];
    let dragIndex: number | null = null;
    const deletedExistingImageIds = new Set<string>();
    let isSaving = false;
    let saveTaskHandle: ProgressTaskHandle | null = null;

    const setSubmitMessage = (message: string): void => {
        submitMsgEl.textContent = message;
    };

    const setSubmitError = (message: string): void => {
        if (!message) {
            submitErrorEl.textContent = "";
            submitErrorEl.classList.add("hidden");
            return;
        }
        submitErrorEl.textContent = message;
        submitErrorEl.classList.remove("hidden");
    };

    const setUploadMessage = (message: string, isError = false): void => {
        uploadMsgEl.textContent = message;
        uploadMsgEl.classList.toggle("text-red-500", isError);
        uploadMsgEl.classList.toggle("text-60", !isError);
    };

    const clearPendingUploads = (): void => {
        for (const pending of pendingUploads.values()) {
            URL.revokeObjectURL(pending.localUrl);
        }
        pendingUploads.clear();
    };

    const removeImageOrderItem = async (
        item: DiaryImageOrderItem,
    ): Promise<void> => {
        if (isSaving) {
            return;
        }
        const confirmed = await showConfirmDialog({
            message: t(I18nKey.diaryEditorDeleteImageConfirm),
            confirmText: t(I18nKey.commonDelete),
            confirmVariant: "danger",
        });
        if (!confirmed) {
            return;
        }

        if (item.kind === "pending" && item.localUrl) {
            const pending = pendingUploads.get(item.localUrl);
            if (pending) {
                URL.revokeObjectURL(pending.localUrl);
                pendingUploads.delete(item.localUrl);
            }
            imageOrderItems = imageOrderItems.filter(
                (current) => current.key !== item.key,
            );
            renderImageOrder();
            setUploadMessage(t(I18nKey.diaryEditorPendingImageRemoved));
            return;
        }

        if (item.kind === "existing" && item.imageId) {
            try {
                deletedExistingImageIds.add(item.imageId);
                imageOrderItems = imageOrderItems.filter(
                    (current) => current.key !== item.key,
                );
                renderImageOrder();
                setUploadMessage(t(I18nKey.diaryEditorImageRemovedPendingSave));
                setSubmitMessage(
                    t(I18nKey.diaryEditorImageAdjustmentsPendingSave),
                );
            } catch (error) {
                console.error("[diary-editor] delete image failed:", error);
                setUploadMessage(t(I18nKey.diaryEditorDeleteImageFailed), true);
            }
        }
    };

    const renderImageOrder = (): void => {
        imageOrderListEl.innerHTML = "";
        imageOrderEmptyEl.classList.toggle(
            "hidden",
            imageOrderItems.length > 0,
        );

        if (imageOrderItems.length === 0) {
            return;
        }

        const fragment = document.createDocumentFragment();
        const gallery = document.createElement("div");
        gallery.className =
            imageOrderItems.length === 1
                ? "w-full"
                : `grid gap-3 ${imageOrderItems.length === 4 ? "grid-cols-2" : "grid-cols-3"}`;

        imageOrderItems.forEach((item, index) => {
            const figure = document.createElement("figure");
            figure.className =
                imageOrderItems.length === 1
                    ? "relative overflow-hidden rounded-xl border border-(--line-divider) bg-(--card-bg) group"
                    : "relative aspect-square overflow-hidden rounded-xl border border-(--line-divider) bg-(--card-bg) group";
            figure.setAttribute("draggable", "true");

            figure.addEventListener("dragstart", () => {
                dragIndex = index;
            });
            figure.addEventListener("dragover", (event) => {
                event.preventDefault();
                if (dragIndex === null || dragIndex === index) {
                    return;
                }
                const dragged = imageOrderItems[dragIndex];
                const next = imageOrderItems.filter((_, i) => i !== dragIndex);
                next.splice(index, 0, dragged);
                imageOrderItems = next;
                dragIndex = index;
                renderImageOrder();
            });
            figure.addEventListener("dragend", () => {
                dragIndex = null;
                setSubmitMessage(t(I18nKey.diaryEditorImageSortPendingSave));
            });

            const previewHref = toStringValue(item.previewUrl || item.localUrl);
            const thumbSrc = toStringValue(
                item.thumbUrl || item.previewUrl || item.localUrl,
            );

            if (previewHref && thumbSrc) {
                const anchor = document.createElement("a");
                anchor.href = previewHref;
                anchor.className = "block w-full h-full";
                anchor.setAttribute("data-fancybox", "diary-photo-preview");
                if (item.caption) {
                    anchor.setAttribute("data-caption", item.caption);
                }

                const image = document.createElement("img");
                image.src = thumbSrc;
                image.alt = item.caption || item.label || "diary image";
                image.loading = "lazy";
                image.className =
                    imageOrderItems.length === 1
                        ? "w-full h-auto object-cover"
                        : "w-full h-full object-cover";

                anchor.appendChild(image);
                figure.appendChild(anchor);
            } else {
                const fallback = document.createElement("div");
                fallback.className =
                    "w-full h-full min-h-24 flex items-center justify-center text-xs text-60";
                fallback.textContent =
                    item.label ||
                    tFmt(I18nKey.diaryEditorImageLabel, {
                        index: index + 1,
                    });
                figure.appendChild(fallback);
            }

            const orderBadge = document.createElement("div");
            orderBadge.className =
                "absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs";
            orderBadge.textContent = String(index + 1);

            const handle = document.createElement("div");
            handle.className =
                "absolute top-2 left-2 w-6 h-6 rounded bg-black/50 text-white flex items-center justify-center cursor-grab opacity-0 group-hover:opacity-100 transition-opacity";
            handle.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" /></svg>';

            const overlay = document.createElement("div");
            overlay.className =
                "absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100";

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className =
                "w-8 h-8 rounded-full bg-red-500/90 text-white flex items-center justify-center hover:bg-red-500 transition cursor-pointer";
            deleteButton.title = t(I18nKey.diaryEditorDeleteImageTitle);
            deleteButton.setAttribute(
                "aria-label",
                t(I18nKey.diaryEditorDeleteImageTitle),
            );
            deleteButton.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
            deleteButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                void removeImageOrderItem(item);
            });
            overlay.appendChild(deleteButton);

            figure.append(orderBadge, handle, overlay);
            gallery.appendChild(figure);
        });

        fragment.appendChild(gallery);

        imageOrderListEl.appendChild(fragment);
    };

    const uploadPendingFile = async (
        file: File,
    ): Promise<MaterializedDiaryUpload> => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("purpose", "diary-image");

        const { response, data } = await api("/api/v1/uploads", {
            method: "POST",
            body: formData,
        });
        if (!response.ok || !data?.ok) {
            throw new Error(
                getApiMessage(data, t(I18nKey.diaryEditorUploadFailed)),
            );
        }
        const fileId = getUploadedFileId(data);
        if (!fileId) {
            throw new Error(t(I18nKey.diaryEditorUploadMissingFileId));
        }
        return {
            localUrl: "",
            fileId,
            remoteUrl: `/api/v1/public/assets/${encodeURIComponent(fileId)}`,
        };
    };

    const normalizeImageEntries = (
        value: unknown,
    ): Array<Record<string, unknown>> => {
        if (!Array.isArray(value)) {
            return [];
        }
        return value
            .map((item) => toRecord(item))
            .filter((item): item is Record<string, unknown> => Boolean(item));
    };

    const getTotalImageCount = (): number => imageOrderItems.length;

    const materializePendingUploads = async (
        source: string,
    ): Promise<{ content: string; uploads: MaterializedDiaryUpload[] }> => {
        const pendingEntries = Array.from(pendingUploads.entries());
        if (pendingEntries.length === 0) {
            return { content: source, uploads: [] };
        }

        let nextContent = source;
        const uploads: MaterializedDiaryUpload[] = [];
        for (let index = 0; index < pendingEntries.length; index += 1) {
            const [localUrl, pending] = pendingEntries[index];
            if (saveTaskHandle !== null) {
                updateTask(saveTaskHandle, {
                    mode: "determinate",
                    percent: Math.round(
                        ((index + 1) / (pendingEntries.length + 1)) * 80,
                    ),
                    text: tFmt(I18nKey.diaryEditorUploadProgress, {
                        current: index + 1,
                        total: pendingEntries.length,
                    }),
                });
            }
            const uploaded = await uploadPendingFile(pending.file);
            uploaded.localUrl = localUrl;
            if (nextContent.includes(localUrl)) {
                nextContent = nextContent
                    .split(localUrl)
                    .join(uploaded.remoteUrl);
            }
            uploads.push(uploaded);
            URL.revokeObjectURL(localUrl);
            pendingUploads.delete(localUrl);
        }
        return {
            content: nextContent,
            uploads,
        };
    };

    const persistDiaryImages = async (
        diaryId: string,
        uploads: MaterializedDiaryUpload[],
    ): Promise<void> => {
        for (const imageId of deletedExistingImageIds) {
            const { response, data } = await api(
                `/api/v1/me/diaries/${encodeURIComponent(diaryId)}/images/${encodeURIComponent(imageId)}`,
                {
                    method: "DELETE",
                },
            );
            if (!response.ok || !data?.ok) {
                throw new Error(
                    getApiMessage(
                        data,
                        t(I18nKey.diaryEditorDeleteImageFailed),
                    ),
                );
            }
        }
        deletedExistingImageIds.clear();

        const uploadMap = new Map<string, MaterializedDiaryUpload>();
        for (const upload of uploads) {
            if (upload.localUrl) {
                uploadMap.set(upload.localUrl, upload);
            }
        }

        for (let index = 0; index < imageOrderItems.length; index += 1) {
            const item = imageOrderItems[index];
            if (item.kind === "existing" && item.imageId) {
                const { response, data } = await api(
                    `/api/v1/me/diaries/${encodeURIComponent(diaryId)}/images/${encodeURIComponent(item.imageId)}`,
                    {
                        method: "PATCH",
                        body: JSON.stringify({ sort: index }),
                    },
                );
                if (!response.ok || !data?.ok) {
                    throw new Error(
                        getApiMessage(
                            data,
                            t(I18nKey.diaryEditorSortUpdateFailed),
                        ),
                    );
                }
                continue;
            }

            if (item.kind === "pending" && item.localUrl) {
                const upload = uploadMap.get(item.localUrl);
                if (!upload) {
                    continue;
                }
                const { response, data } = await api(
                    `/api/v1/me/diaries/${encodeURIComponent(diaryId)}/images`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            file_id: upload.fileId,
                            image_url: null,
                            caption: null,
                            is_public: isPublicInput.checked,
                            show_on_profile: true,
                            sort: index,
                        }),
                    },
                );
                if (!response.ok || !data?.ok) {
                    throw new Error(
                        getApiMessage(
                            data,
                            t(I18nKey.diaryEditorImageSyncFailed),
                        ),
                    );
                }
            }
        }
    };

    const setSavingState = (nextSaving: boolean): void => {
        isSaving = nextSaving;
        savePublishedBtn.disabled = nextSaving;
        if (!nextSaving) {
            savePublishedBtn.textContent = publishButtonIdleText;
            return;
        }
        savePublishedBtn.textContent = publishButtonLoadingText;
    };

    const fillDiaryForm = (item: DiaryItem): void => {
        allowCommentsInput.checked = toBooleanValue(item.allow_comments, true);
        isPublicInput.checked = toBooleanValue(item.praviate, true);
        contentInput.value = toStringValue(item.content);
    };

    const loadDetail = async (id: string): Promise<void> => {
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
            fillDiaryForm({
                id: toStringValue(item.id),
                short_id: toNullableString(item.short_id),
                content: toNullableString(item.content),
                allow_comments: toBooleanValue(item.allow_comments, true),
                praviate: toBooleanValue(item.praviate, true),
            });

            const imageFileIds = normalizeImageEntries(data.images)
                .map((image) => toStringValue(image.file_id))
                .filter(Boolean);
            const nextOrderItems: DiaryImageOrderItem[] = [];
            normalizeImageEntries(data.images).forEach((image, index) => {
                const imageId = toStringValue(image.id);
                if (!imageId) {
                    return;
                }
                const caption = toStringValue(image.caption);
                const fileId = toStringValue(image.file_id);
                const imageUrl = toStringValue(image.image_url);
                const previewUrl = fileId
                    ? `/api/v1/public/assets/${encodeURIComponent(fileId)}?width=1920`
                    : imageUrl;
                const thumbUrl = fileId
                    ? `/api/v1/public/assets/${encodeURIComponent(fileId)}?width=720&height=720&fit=cover`
                    : imageUrl;
                const label =
                    caption ||
                    fileId ||
                    imageUrl ||
                    tFmt(I18nKey.diaryEditorImageLabel, {
                        index: index + 1,
                    });
                nextOrderItems.push({
                    key: `existing:${imageId}`,
                    kind: "existing",
                    label,
                    caption: caption || undefined,
                    previewUrl: previewUrl || undefined,
                    thumbUrl: thumbUrl || undefined,
                    imageId,
                });
            });
            imageOrderItems = nextOrderItems;
            if (imageFileIds.length === 0 && imageOrderItems.length === 0) {
                imageOrderItems = [];
            }
            renderImageOrder();

            currentDiaryId = toStringValue(item.id);
            setSubmitMessage(t(I18nKey.diaryEditorLoadedReadyEdit));
        } catch (error) {
            console.error("[diary-editor] load detail failed:", error);
            setSubmitError(t(I18nKey.diaryEditorLoadDiaryFailedRetry));
            setSubmitMessage("");
        }
    };

    const saveDiary = async (): Promise<void> => {
        const sourceContent = String(contentInput.value || "");
        if (!sourceContent.trim()) {
            setSubmitError(t(I18nKey.diaryEditorContentRequired));
            return;
        }

        const pendingCount = pendingUploads.size;
        saveTaskHandle = startTask({
            title:
                editorMode === "edit"
                    ? t(I18nKey.diaryEditorSavingTitle)
                    : t(I18nKey.diaryEditorPublishingTitle),
            mode: pendingCount > 0 ? "determinate" : "indeterminate",
            percent: 0,
            text:
                pendingCount > 0
                    ? t(I18nKey.diaryEditorPreparingUpload)
                    : t(I18nKey.diaryEditorSubmittingDiary),
        });

        let content = sourceContent.trim();
        let materializedUploads: MaterializedDiaryUpload[] = [];
        let uploadStageFailed = false;

        setSubmitError("");
        setSubmitMessage(
            editorMode === "edit"
                ? t(I18nKey.diaryEditorSaving)
                : t(I18nKey.diaryEditorPublishing),
        );
        setSavingState(true);

        try {
            const materialized = await materializePendingUploads(content).catch(
                (error: unknown) => {
                    uploadStageFailed = true;
                    throw error;
                },
            );
            content = materialized.content;
            materializedUploads = materialized.uploads;

            if (saveTaskHandle !== null) {
                updateTask(saveTaskHandle, {
                    mode: "determinate",
                    percent: 85,
                    text: t(I18nKey.diaryEditorSavingContent),
                });
            }

            if (content !== sourceContent.trim()) {
                contentInput.value = content;
            }

            const payload = {
                content,
                allow_comments: allowCommentsInput.checked,
                praviate: isPublicInput.checked,
                status: "published",
            };

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
                setSubmitError(
                    getApiMessage(data, t(I18nKey.diaryEditorSaveFailed)),
                );
                setSubmitMessage("");
                return;
            }

            const item = toRecord(data.item);
            const id = toStringValue(item?.id);
            const shortId = toStringValue(item?.short_id);
            const targetId = shortId || id;
            if (!targetId || !id) {
                setSubmitError(t(I18nKey.diaryEditorSaveMissingDiaryId));
                setSubmitMessage("");
                return;
            }

            currentDiaryId = id;

            try {
                if (saveTaskHandle !== null) {
                    updateTask(saveTaskHandle, {
                        mode: "determinate",
                        percent: 92,
                        text: t(I18nKey.diaryEditorSyncingImageOrder),
                    });
                }
                await persistDiaryImages(id, materializedUploads);
            } catch (error) {
                console.error(
                    "[diary-editor] persist diary images failed:",
                    error,
                );
                const message =
                    error instanceof Error && error.message
                        ? error.message
                        : t(I18nKey.diaryEditorPartialImageSyncFailed);
                setUploadMessage(message, true);
            }

            if (saveTaskHandle !== null) {
                updateTask(saveTaskHandle, {
                    mode: "determinate",
                    percent: 100,
                    text: t(I18nKey.diaryEditorSaveCompleted),
                });
            }

            setSubmitMessage(
                editorMode === "edit"
                    ? t(I18nKey.diaryEditorSaveSuccessRedirecting)
                    : t(I18nKey.diaryEditorPublishSuccessRedirecting),
            );
            navigateToPage(
                `/${username}/diary/${encodeURIComponent(targetId)}`,
                {
                    force: true,
                },
            );
            return;
        } catch (error) {
            console.error("[diary-editor] save failed:", error);
            const message =
                error instanceof Error && error.message
                    ? error.message
                    : t(I18nKey.diaryEditorSaveFailedRetry);
            if (uploadStageFailed) {
                setUploadMessage(message, true);
                setSubmitError(t(I18nKey.diaryEditorUploadFailedUnsaved));
                setSubmitMessage("");
                return;
            }
            setSubmitError(t(I18nKey.diaryEditorSaveFailedRetry));
            setSubmitMessage("");
        } finally {
            setSavingState(false);
            if (saveTaskHandle !== null) {
                finishTask(saveTaskHandle);
                saveTaskHandle = null;
            }
        }
    };

    const stageImage = (file: File): void => {
        const totalImageCount = getTotalImageCount();
        if (totalImageCount >= MAX_DIARY_UPLOAD_COUNT) {
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
        pendingUploads.set(localUrl, {
            file,
            localUrl,
        });
        imageOrderItems.push({
            key: `pending:${localUrl}`,
            kind: "pending",
            label:
                file.name ||
                tFmt(I18nKey.diaryEditorImageLabel, {
                    index: imageOrderItems.length + 1,
                }),
            caption: file.name || undefined,
            previewUrl: localUrl,
            thumbUrl: localUrl,
            localUrl,
        });
        renderImageOrder();
        setUploadMessage(t(I18nKey.diaryEditorStagedUpload));
        uploadFileInput.value = "";
    };

    savePublishedBtn.addEventListener("click", () => {
        void saveDiary();
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
        stageImage(file);
    });

    if (editorMode === "edit") {
        void loadDetail(currentDiaryId);
    } else {
        renderImageOrder();
    }

    window.addEventListener("beforeunload", () => {
        clearPendingUploads();
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
    });
}
