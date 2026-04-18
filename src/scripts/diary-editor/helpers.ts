import I18nKey from "@/i18n/i18nKey";
import { t, tFmt } from "@/scripts/shared/i18n-runtime";
import type { ProgressTaskHandle } from "@/scripts/shared/progress-overlay-manager";
import { updateTask } from "@/scripts/shared/progress-overlay-manager";
import { getCsrfToken } from "@/utils/csrf";

export type EditorMode = "create" | "edit";

export type InitOptions = {
    mode: EditorMode;
    username: string;
    diaryId?: string;
};

export type ApiResult = {
    response: Response;
    data: Record<string, unknown> | null;
};

export type DiaryItem = {
    id: string;
    short_id?: string | null;
    content?: string | null;
    allow_comments?: boolean;
    praviate?: boolean;
};

export type PendingDiaryUpload = {
    file: File;
    localUrl: string;
};

export type MaterializedDiaryUpload = {
    localUrl: string;
    fileId: string;
    remoteUrl: string;
};

export type DiaryImageOrderItem = {
    key: string;
    kind: "existing" | "pending";
    label: string;
    caption?: string;
    previewUrl?: string;
    thumbUrl?: string;
    imageId?: string;
    localUrl?: string;
};

function normalizeApiUrl(url: string): string {
    if (!url.startsWith("/")) {
        return `/${url}`;
    }
    return url;
}

export async function api(url: string, init: RequestInit): Promise<ApiResult> {
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

export function toStringValue(value: unknown): string {
    return String(value ?? "").trim();
}

export function toNullableString(value: unknown): string | null {
    const normalized = toStringValue(value);
    return normalized ? normalized : null;
}

export function toBooleanValue(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    return fallback;
}

export function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function getApiMessage(
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

export function getUploadedFileId(
    data: Record<string, unknown> | null,
): string {
    const file = toRecord(data?.file);
    const idFromFile = toStringValue(file?.id);
    if (idFromFile) {
        return idFromFile;
    }
    return toStringValue(data?.id);
}

export function normalizeImageEntries(
    value: unknown,
): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => toRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
}

export async function uploadPendingFile(
    file: File,
): Promise<MaterializedDiaryUpload> {
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
}

export async function materializePendingUploads(
    source: string,
    pendingUploads: Map<string, PendingDiaryUpload>,
    saveTaskHandle: ProgressTaskHandle | null,
): Promise<{ content: string; uploads: MaterializedDiaryUpload[] }> {
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
            nextContent = nextContent.split(localUrl).join(uploaded.remoteUrl);
        }
        uploads.push(uploaded);
    }
    return {
        content: nextContent,
        uploads,
    };
}

export function commitMaterializedDiaryUploads(
    pendingUploads: Map<string, PendingDiaryUpload>,
    uploads: MaterializedDiaryUpload[],
): void {
    for (const upload of uploads) {
        const localUrl = toStringValue(upload.localUrl);
        if (!localUrl) {
            continue;
        }
        const pending = pendingUploads.get(localUrl);
        if (!pending) {
            continue;
        }
        URL.revokeObjectURL(pending.localUrl);
        pendingUploads.delete(localUrl);
    }
}

export async function deleteExistingImages(
    diaryId: string,
    deletedExistingImageIds: Set<string>,
): Promise<void> {
    for (const imageId of deletedExistingImageIds) {
        const { response, data } = await api(
            `/api/v1/me/diaries/${encodeURIComponent(diaryId)}/images/${encodeURIComponent(imageId)}`,
            {
                method: "DELETE",
            },
        );
        if (!response.ok || !data?.ok) {
            throw new Error(
                getApiMessage(data, t(I18nKey.diaryEditorDeleteImageFailed)),
            );
        }
    }
    deletedExistingImageIds.clear();
}

export async function updateExistingImageSort(
    diaryId: string,
    imageId: string,
    sort: number,
): Promise<void> {
    const { response, data } = await api(
        `/api/v1/me/diaries/${encodeURIComponent(diaryId)}/images/${encodeURIComponent(imageId)}`,
        {
            method: "PATCH",
            body: JSON.stringify({ sort }),
        },
    );
    if (!response.ok || !data?.ok) {
        throw new Error(
            getApiMessage(data, t(I18nKey.diaryEditorSortUpdateFailed)),
        );
    }
}

export async function createDiaryImage(
    diaryId: string,
    upload: MaterializedDiaryUpload,
    isPublic: boolean,
    sort: number,
): Promise<void> {
    const { response, data } = await api(
        `/api/v1/me/diaries/${encodeURIComponent(diaryId)}/images`,
        {
            method: "POST",
            body: JSON.stringify({
                file_id: upload.fileId,
                image_url: null,
                caption: null,
                is_public: isPublic,
                show_on_profile: true,
                sort,
            }),
        },
    );
    if (!response.ok || !data?.ok) {
        throw new Error(
            getApiMessage(data, t(I18nKey.diaryEditorImageSyncFailed)),
        );
    }
}

export async function persistDiaryImages(
    diaryId: string,
    uploads: MaterializedDiaryUpload[],
    imageOrderItems: DiaryImageOrderItem[],
    deletedExistingImageIds: Set<string>,
    isPublic: boolean,
): Promise<void> {
    await deleteExistingImages(diaryId, deletedExistingImageIds);

    const uploadMap = new Map<string, MaterializedDiaryUpload>();
    for (const upload of uploads) {
        if (upload.localUrl) {
            uploadMap.set(upload.localUrl, upload);
        }
    }

    for (let index = 0; index < imageOrderItems.length; index += 1) {
        const item = imageOrderItems[index];
        if (item.kind === "existing" && item.imageId) {
            await updateExistingImageSort(diaryId, item.imageId, index);
            continue;
        }

        if (item.kind === "pending" && item.localUrl) {
            const upload = uploadMap.get(item.localUrl);
            if (!upload) {
                continue;
            }
            await createDiaryImage(diaryId, upload, isPublic, index);
        }
    }
}

export function buildImageOrderItemFromEntry(
    image: Record<string, unknown>,
    index: number,
): DiaryImageOrderItem | null {
    const imageId = toStringValue(image.id);
    if (!imageId) {
        return null;
    }
    const caption = toStringValue(image.caption);
    const fileId = toStringValue(image.file_id);
    const imageUrl = toStringValue(image.image_url);
    const previewUrl = fileId
        ? `/api/v1/assets/${encodeURIComponent(fileId)}?width=1920`
        : imageUrl;
    const thumbUrl = fileId
        ? `/api/v1/assets/${encodeURIComponent(fileId)}?width=720&height=720&fit=cover`
        : imageUrl;
    const label =
        caption ||
        fileId ||
        imageUrl ||
        tFmt(I18nKey.diaryEditorImageLabel, {
            index: index + 1,
        });
    return {
        key: `existing:${imageId}`,
        kind: "existing",
        label,
        caption: caption || undefined,
        previewUrl: previewUrl || undefined,
        thumbUrl: thumbUrl || undefined,
        imageId,
    };
}
