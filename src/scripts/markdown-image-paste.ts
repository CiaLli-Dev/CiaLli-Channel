import { getCsrfToken } from "@/utils/csrf";
import { generateClientShortId } from "@/utils/short-id";

type MarkdownImagePasteUploaderOptions = {
    textarea: HTMLTextAreaElement;
    fileNamePrefix?: string;
    shortId?: string;
    buildAssetUrl?: (fileId: string) => string;
    buildUploadTitle?: (context: UploadTitleContext) => string;
    autoUpload?: boolean;
    onContentChange?: () => void;
    onError?: (message: string) => void;
    onPendingChange?: (pendingCount: number) => void;
};

type UploadTitleContext = {
    sequence: number;
    shortId: string;
    fileNamePrefix: string;
    file: File;
};

type PendingPasteImage = {
    localUrl: string;
    markdown: string;
    file: File;
    sequence: number;
};

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    return "";
}

function getApiMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    const message = toStringValue(data?.message);
    if (message) {
        return message;
    }
    const error = toRecord(data?.error);
    const errorMessage = toStringValue(error?.message);
    return errorMessage || fallback;
}

function getImageFileExt(file: File): string {
    const mimeMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/avif": "avif",
    };
    return mimeMap[file.type] || "jpg";
}

function insertSelection(
    textarea: HTMLTextAreaElement,
    replacement: string,
): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const source = textarea.value;
    const before = source.slice(0, start);
    const after = source.slice(end);
    const nextCursor = before.length + replacement.length;
    textarea.value = `${before}${replacement}${after}`;
    textarea.focus();
    textarea.setSelectionRange(nextCursor, nextCursor);
}

export class MarkdownImagePasteUploader {
    private readonly textarea: HTMLTextAreaElement;

    private readonly fileNamePrefix: string;

    private readonly onContentChange?: () => void;

    private readonly buildAssetUrl?: (fileId: string) => string;

    private readonly buildUploadTitle?: (context: UploadTitleContext) => string;

    private readonly autoUpload: boolean;

    private readonly onError?: (message: string) => void;

    private readonly onPendingChange?: (pendingCount: number) => void;

    private readonly pendingImages = new Map<string, PendingPasteImage>();

    private readonly activeUploads = new Map<string, Promise<void>>();

    private sequence = 0;

    private readonly shortId: string;

    constructor(options: MarkdownImagePasteUploaderOptions) {
        this.textarea = options.textarea;
        this.fileNamePrefix = options.fileNamePrefix || "markdown-image";
        this.shortId = this.resolveShortId(options.shortId);
        this.buildAssetUrl = options.buildAssetUrl;
        this.buildUploadTitle = options.buildUploadTitle;
        this.autoUpload = options.autoUpload ?? true;
        this.onContentChange = options.onContentChange;
        this.onError = options.onError;
        this.onPendingChange = options.onPendingChange;
    }

    private resolveShortId(input: string | undefined): string {
        const value = String(input || "").trim();
        if (/^CL[0-9A-Za-z]{10}$/.test(value)) {
            return value;
        }
        return generateClientShortId();
    }

    hasPendingUploads(): boolean {
        return this.pendingImages.size > 0 || this.activeUploads.size > 0;
    }

    dispose(): void {
        for (const localUrl of this.pendingImages.keys()) {
            URL.revokeObjectURL(localUrl);
        }
        this.pendingImages.clear();
        this.activeUploads.clear();
        this.emitPendingChange();
    }

    async flushPendingUploads(): Promise<boolean> {
        while (true) {
            if (!this.autoUpload) {
                this.startAllPendingUploads();
            }
            if (this.activeUploads.size === 0) {
                break;
            }
            await Promise.allSettled(Array.from(this.activeUploads.values()));
        }
        return (
            !/\]\(\s*blob:[^)]+\)/i.test(this.textarea.value) &&
            !this.hasPendingUploads()
        );
    }

    handlePaste(event: ClipboardEvent): void {
        const items = event.clipboardData?.items;
        if (!items || items.length === 0) {
            return;
        }

        for (const item of items) {
            if (!item.type.startsWith("image/")) {
                continue;
            }
            const file = item.getAsFile();
            if (!file) {
                continue;
            }

            event.preventDefault();
            this.sequence += 1;

            const localUrl = URL.createObjectURL(file);
            const markdown = `![image](${localUrl})`;
            insertSelection(this.textarea, markdown);
            this.onContentChange?.();

            this.pendingImages.set(localUrl, {
                localUrl,
                markdown,
                file,
                sequence: this.sequence,
            });
            this.emitPendingChange();

            if (this.autoUpload) {
                this.startUpload(localUrl);
            }
            break;
        }
    }

    private emitPendingChange(): void {
        this.onPendingChange?.(this.pendingImages.size);
    }

    private startAllPendingUploads(): void {
        for (const localUrl of this.pendingImages.keys()) {
            this.startUpload(localUrl);
        }
    }

    private startUpload(localUrl: string): void {
        if (!this.pendingImages.has(localUrl)) {
            return;
        }
        if (this.activeUploads.has(localUrl)) {
            return;
        }
        const params = this.pendingImages.get(localUrl);
        if (!params) {
            return;
        }
        const promise = this.uploadImage(params).finally(() => {
            this.activeUploads.delete(localUrl);
            this.emitPendingChange();
        });
        this.activeUploads.set(localUrl, promise);
    }

    private resolveRemoteUrl(fileId: string): string {
        return (
            this.buildAssetUrl?.(fileId) ||
            `/api/v1/assets/${encodeURIComponent(fileId)}`
        );
    }

    private applyUploadSuccess(localUrl: string, fileId: string): void {
        const remoteUrl = this.resolveRemoteUrl(fileId);
        this.textarea.value = this.textarea.value
            .split(localUrl)
            .join(remoteUrl);
        this.onContentChange?.();
    }

    private applyUploadFailure(
        localUrl: string,
        markdown: string,
        message: string,
    ): void {
        this.textarea.value = this.textarea.value
            .split(markdown)
            .join("")
            .split(localUrl)
            .join("");
        this.onContentChange?.();
        this.onError?.(message);
    }

    private async uploadImage(params: PendingPasteImage): Promise<void> {
        const { localUrl, markdown, file, sequence } = params;
        const ext = getImageFileExt(file);
        const now = Date.now();
        const fileName = `${this.fileNamePrefix}-${now}-${sequence}.${ext}`;
        const uploadTitle =
            this.buildUploadTitle?.({
                sequence,
                shortId: this.shortId,
                fileNamePrefix: this.fileNamePrefix,
                file,
            }) || `${this.fileNamePrefix}-${now}-${sequence}`;
        const formData = new FormData();
        formData.set("file", file, fileName);
        formData.set("purpose", "general");
        formData.set("title", uploadTitle);

        try {
            const response = await fetch("/api/v1/uploads", {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json",
                    "x-csrf-token": getCsrfToken(),
                },
                body: formData,
            });
            const data = (await response.json().catch(() => null)) as Record<
                string,
                unknown
            > | null;
            if (!response.ok || !data?.ok) {
                throw new Error(getApiMessage(data, "图片上传失败"));
            }

            const fileRecord = toRecord(data.file);
            const fileId =
                toStringValue(fileRecord?.id) || toStringValue(data.id);
            if (!fileId) {
                throw new Error("图片上传失败：未返回文件 ID");
            }

            this.applyUploadSuccess(localUrl, fileId);
        } catch (error) {
            console.error("[markdown-image-paste] upload failed:", error);
            const message =
                error instanceof Error
                    ? error.message
                    : "图片上传失败，请稍后重试";
            this.applyUploadFailure(localUrl, markdown, message);
        } finally {
            this.pendingImages.delete(localUrl);
            URL.revokeObjectURL(localUrl);
        }
    }
}
