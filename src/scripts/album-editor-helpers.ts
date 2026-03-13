import { getCsrfToken } from "@/utils/csrf";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ApiResult = {
    response: Response;
    data: Record<string, unknown> | null;
};

export type UploadPermissionState = {
    can_upload_files?: boolean;
    can_manage_albums?: boolean;
};

export type PhotoItem = {
    id: string;
    file_id: string | null;
    image_url: string | null;
    title: string | null;
    description: string | null;
    tags: string[];
    location: string | null;
    sort: number | null;
};

export type PhotoRef = {
    file_id: string | null;
    image_url: string | null;
};

/* ------------------------------------------------------------------ */
/* ID / URL utilities                                                  */
/* ------------------------------------------------------------------ */

export function createPendingId(): string {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeApiUrl(input: string): string {
    const [pathname, search = ""] = String(input || "").split("?");
    const normalizedPath = pathname.endsWith("/")
        ? pathname.slice(0, -1)
        : pathname;
    return search ? `${normalizedPath}?${search}` : normalizedPath;
}

/* ------------------------------------------------------------------ */
/* API client                                                          */
/* ------------------------------------------------------------------ */

export async function api(
    url: string,
    init: RequestInit = {},
): Promise<ApiResult> {
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
    const data: Record<string, unknown> | null = await response
        .json()
        .catch(() => null);
    return { response, data };
}

export function getApiMessage(
    data: Record<string, unknown> | null,
    fallback = "未知错误",
): string {
    const error = data?.error as Record<string, unknown> | undefined;
    const message = error?.message;
    return typeof message === "string" && message.trim() ? message : fallback;
}

/* ------------------------------------------------------------------ */
/* File ID extraction                                                  */
/* ------------------------------------------------------------------ */

export function extractFileId(payload: Record<string, unknown> | null): string {
    const directId = payload?.id;
    if (typeof directId === "string" && directId.trim()) {
        return directId.trim();
    }
    const file = payload?.file;
    if (file && typeof file === "object") {
        const nestedId = (file as { id?: unknown }).id;
        if (typeof nestedId === "string" && nestedId.trim()) {
            return nestedId.trim();
        }
    }
    return "";
}

/* ------------------------------------------------------------------ */
/* Value coercion helpers                                              */
/* ------------------------------------------------------------------ */

export function toOptionalText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized ? normalized : null;
}

export function toNumberOrNull(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

export function toTagsArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean);
    }
    if (typeof value === "string") {
        return value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return [];
}

/* ------------------------------------------------------------------ */
/* Photo parsing                                                       */
/* ------------------------------------------------------------------ */

export function parsePhotoItem(raw: unknown): PhotoItem | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const id = toOptionalText(record.id);
    if (!id) {
        return null;
    }
    return {
        id,
        file_id: toOptionalText(record.file_id),
        image_url: toOptionalText(record.image_url),
        title: toOptionalText(record.title),
        description: toOptionalText(record.description),
        tags: toTagsArray(record.tags),
        location: toOptionalText(record.location),
        sort: toNumberOrNull(record.sort),
    };
}

/* ------------------------------------------------------------------ */
/* File / image utilities                                              */
/* ------------------------------------------------------------------ */

export function getImageFileExt(file: File): string {
    const name = String(file.name || "");
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex > -1 && dotIndex < name.length - 1) {
        return name.slice(dotIndex + 1).toLowerCase();
    }
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    if (file.type === "image/gif") return "gif";
    return "jpg";
}

export function buildAlbumPhotoName(
    albumIdValue: string,
    index: number,
): string {
    const normalizedAlbumId = String(albumIdValue || "").trim() || "album";
    const normalizedIndex = String(index).padStart(2, "0");
    return `Albums ${normalizedAlbumId}-${normalizedIndex}`;
}

export function photoSrc(
    photo: PhotoRef,
    assetUrlPrefix: string,
    size = 600,
): string {
    if (photo.image_url) return photo.image_url;
    if (photo.file_id) {
        return `${assetUrlPrefix}/${photo.file_id}?width=${size}&height=${size}&fit=cover`;
    }
    return "";
}

export function photoPreviewSrc(
    photo: PhotoRef,
    assetUrlPrefix: string,
): string {
    if (photo.image_url) {
        return photo.image_url;
    }
    if (photo.file_id) {
        return `${assetUrlPrefix}/${photo.file_id}?width=1920`;
    }
    return "";
}

export function photoDisplaySrc(
    photo: PhotoRef,
    layout: "grid" | "masonry",
    assetUrlPrefix: string,
): string {
    if (layout === "masonry") {
        return (
            photoPreviewSrc(photo, assetUrlPrefix) ||
            photoSrc(photo, assetUrlPrefix)
        );
    }
    return photoSrc(photo, assetUrlPrefix);
}

export function photoCaption(photo: {
    title: string | null;
    description: string | null;
}): string {
    return [photo.title, photo.description].filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------ */
/* Display formatting                                                  */
/* ------------------------------------------------------------------ */

export function buildGoogleMapsSearchUrl(
    value: string | null | undefined,
): string {
    const query = String(value || "").trim();
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function formatAlbumDateDisplay(
    value: string | null | undefined,
): string {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return raw;
    }
    return `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Permission check                                                    */
/* ------------------------------------------------------------------ */

export async function ensureUploadPermissions(): Promise<void> {
    const { response, data } = await api("/api/v1/me/permissions");
    if (!response.ok || !data?.permissions) {
        throw new Error(
            `无法校验上传权限：${getApiMessage(data, response.statusText || "未知错误")}`,
        );
    }
    const permissionState = data.permissions as UploadPermissionState;
    if (permissionState.can_upload_files === false) {
        throw new Error("账号未开启文件上传权限（can_upload_files）");
    }
    if (permissionState.can_manage_albums === false) {
        throw new Error("账号未开启相册管理权限（can_manage_albums）");
    }
}

/* ------------------------------------------------------------------ */
/* Metadata payload builder                                            */
/* ------------------------------------------------------------------ */

export type AlbumMetadataInput = {
    title: string;
    description: string;
    category: string;
    tags: string;
    date: string;
    location: string;
    layout: "grid" | "masonry";
    isPublic: boolean;
};

export function buildAlbumUpdatePayload(
    input: AlbumMetadataInput,
): Record<string, unknown> {
    return {
        title: input.title,
        description: input.description || null,
        category: input.category || null,
        tags: input.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        date: input.date || null,
        location: input.location || null,
        layout: input.layout,
        is_public: input.isPublic,
    };
}

/* ------------------------------------------------------------------ */
/* Metadata response parser                                            */
/* ------------------------------------------------------------------ */

export type AlbumMetadataState = {
    title: string;
    description: string;
    category: string;
    date: string;
    location: string;
    layout: "grid" | "masonry";
    status: "private" | "published";
    isPublic: boolean;
    tags: string;
};

export function parseAlbumMetadataResponse(
    updatedItem: Record<string, unknown>,
): AlbumMetadataState {
    return {
        title: toOptionalText(updatedItem.title) || "",
        description: toOptionalText(updatedItem.description) || "",
        category: toOptionalText(updatedItem.category) || "",
        date: toOptionalText(updatedItem.date) || "",
        location: toOptionalText(updatedItem.location) || "",
        layout: updatedItem.layout === "masonry" ? "masonry" : "grid",
        status: updatedItem.status === "published" ? "published" : "private",
        isPublic: Boolean(updatedItem.is_public),
        tags: toTagsArray(updatedItem.tags).join(", "),
    };
}

/* ------------------------------------------------------------------ */
/* Upload helpers                                                      */
/* ------------------------------------------------------------------ */

export async function uploadFileToServer(
    file: File,
    fileName: string,
): Promise<string> {
    const uploadForm = new FormData();
    uploadForm.append("file", file, fileName);
    uploadForm.append("title", fileName.replace(/\.[^.]+$/, ""));
    uploadForm.append("purpose", "album-photo");
    const { response: uploadRes, data: uploadData } = await api(
        "/api/v1/uploads",
        { method: "POST", body: uploadForm },
    );
    if (!uploadRes.ok) {
        throw new Error(
            `上传图片失败：${getApiMessage(uploadData, uploadRes.statusText || "未知错误")}`,
        );
    }
    const fileId = extractFileId(uploadData);
    if (!fileId) {
        throw new Error("上传图片失败：无文件 ID");
    }
    return fileId;
}

export async function addPhotoToAlbum(
    albumId: string,
    payload: { file_id?: string; image_url?: string },
): Promise<PhotoItem> {
    const { response: photoRes, data: photoData } = await api(
        `/api/v1/me/albums/${albumId}/photos`,
        {
            method: "POST",
            body: JSON.stringify(payload),
        },
    );
    if (!photoRes.ok) {
        const label =
            "file_id" in payload ? "写入相册失败" : "写入外链图片失败";
        throw new Error(
            `${label}：${getApiMessage(photoData, photoRes.statusText || "未知错误")}`,
        );
    }
    const createdPhoto = parsePhotoItem(photoData?.item);
    if (!createdPhoto) {
        const label =
            "file_id" in payload ? "写入相册失败" : "写入外链图片失败";
        throw new Error(`${label}：返回数据异常`);
    }
    return createdPhoto;
}

export type PendingLocalPhoto = {
    id: string;
    file: File;
    previewUrl: string;
};

export type PendingExternalPhoto = {
    id: string;
    url: string;
};

export type SaveProgressCallback = (
    done: number,
    total: number,
    text: string,
) => void;

export type AlbumMetadataResult = {
    title: string;
    description: string;
    category: string;
    date: string;
    location: string;
    layout: "grid" | "masonry";
    status: "private" | "published";
    isPublic: boolean;
    tags: string;
};

export async function submitAlbumMetadataHelper(
    albumId: string,
    input: AlbumMetadataInput,
    doneSteps: number,
    totalSteps: number,
    onProgress: SaveProgressCallback,
): Promise<{ next: number; result: AlbumMetadataResult | null }> {
    const metadataPayload = buildAlbumUpdatePayload(input);
    const { response, data } = await api(`/api/v1/me/albums/${albumId}`, {
        method: "PATCH",
        body: JSON.stringify(metadataPayload),
    });
    if (!response.ok) {
        throw new Error(
            `保存信息失败：${getApiMessage(data, response.statusText || "未知错误")}`,
        );
    }
    const updatedItem = data?.item as Record<string, unknown> | undefined;
    const result = updatedItem ? parseAlbumMetadataResponse(updatedItem) : null;
    const next = doneSteps + 1;
    onProgress(next, totalSteps, "相册信息已保存");
    return { next, result };
}

export async function processLocalQueueHelper(
    albumId: string,
    albumShortId: string | null,
    localQueue: PendingLocalPhoto[],
    startPhotoCount: number,
    doneSteps: number,
    totalSteps: number,
    onProgress: SaveProgressCallback,
    onPhotoAdded: (photo: PhotoItem) => void,
    onPhotoDone: (id: string) => void,
): Promise<number> {
    const { ALBUM_PHOTO_MAX } = await import("@/constants/text-limits");
    let currentPhotoCount = startPhotoCount;
    let steps = doneSteps;
    for (let i = 0; i < localQueue.length; i++) {
        if (currentPhotoCount >= ALBUM_PHOTO_MAX) {
            throw new Error(`保存失败：相册最多 ${ALBUM_PHOTO_MAX} 张照片`);
        }
        const pending = localQueue[i];
        const fileIndex = currentPhotoCount + 1;
        const fileBaseName = buildAlbumPhotoName(
            albumShortId || albumId,
            fileIndex,
        );
        const fileExt = getImageFileExt(pending.file);
        onProgress(
            steps,
            totalSteps,
            `上传图片 ${i + 1}/${localQueue.length}...`,
        );
        const fileId = await uploadFileToServer(
            pending.file,
            `${fileBaseName}.${fileExt}`,
        );
        steps += 1;
        onProgress(
            steps,
            totalSteps,
            `写入相册 ${i + 1}/${localQueue.length}...`,
        );
        const photo = await addPhotoToAlbum(albumId, { file_id: fileId });
        onPhotoAdded(photo);
        currentPhotoCount += 1;
        steps += 1;
        onPhotoDone(pending.id);
    }
    return steps;
}

export async function processExternalQueueHelper(
    albumId: string,
    externalQueue: PendingExternalPhoto[],
    startPhotoCount: number,
    doneSteps: number,
    totalSteps: number,
    onProgress: SaveProgressCallback,
    onPhotoAdded: (photo: PhotoItem) => void,
    onPhotoDone: (id: string) => void,
): Promise<void> {
    const { ALBUM_PHOTO_MAX } = await import("@/constants/text-limits");
    let currentPhotoCount = startPhotoCount;
    let steps = doneSteps;
    for (let i = 0; i < externalQueue.length; i++) {
        if (currentPhotoCount >= ALBUM_PHOTO_MAX) {
            throw new Error(`保存失败：相册最多 ${ALBUM_PHOTO_MAX} 张照片`);
        }
        const pending = externalQueue[i];
        onProgress(
            steps,
            totalSteps,
            `写入外链图片 ${i + 1}/${externalQueue.length}...`,
        );
        const photo = await addPhotoToAlbum(albumId, {
            image_url: pending.url,
        });
        onPhotoAdded(photo);
        currentPhotoCount += 1;
        steps += 1;
        onPhotoDone(pending.id);
    }
}
