/**
 * site-settings-page 的图片上传模块。
 *
 * 包含 uploadImageBlob 与 uploadPendingCropImages 等上传工具函数，
 * 从 site-settings-page-editor 拆分以保持文件行数在 ESLint 限制内。
 */

import type { UploadPurpose } from "@/constants/upload-limits";
import I18nKey from "@/i18n/i18nKey";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";
import { t } from "@/scripts/i18n-runtime";
import { setMsg } from "@/scripts/dom-helpers";
import {
    pendingCropBlobs,
    updateImagePreview,
} from "@/scripts/site-settings-page-editor";
import type { PendingCropEntry } from "@/scripts/site-settings-page-editor";

// ---------------------------------------------------------------------------
// 上传类型
// ---------------------------------------------------------------------------

export type UpdateFn = (opts: {
    mode: "determinate" | "indeterminate";
    text: string;
    percent?: number;
}) => void;

// ---------------------------------------------------------------------------
// 上传单张图片
// ---------------------------------------------------------------------------

export const uploadImageBlob = async (
    blob: Blob,
    messageTarget: string,
    titleBase: string,
    fileExt = "jpg",
    targetFormat?: "ico",
    purpose?: UploadPurpose,
): Promise<string | null> => {
    setMsg(messageTarget, t(I18nKey.interactionCommonImageUploading));
    try {
        const formData = new FormData();
        formData.append("file", blob, `${titleBase}.${fileExt}`);
        formData.append("title", titleBase);
        if (targetFormat === "ico") {
            formData.append("target_format", "ico");
        }
        if (purpose) {
            formData.append("purpose", purpose);
        }
        const { response, data } = await api("/api/v1/uploads", {
            method: "POST",
            body: formData,
        });
        if (
            !response.ok ||
            !data?.ok ||
            !(data?.file as Record<string, unknown> | undefined)?.id
        ) {
            setMsg(
                messageTarget,
                getApiErrorMessage(
                    data,
                    t(I18nKey.interactionCommonImageUploadFailedRetry),
                ),
            );
            return null;
        }
        setMsg(messageTarget, "");
        return String((data.file as Record<string, unknown>).id || "");
    } catch (error) {
        console.error("[site-settings-page] upload failed", error);
        setMsg(
            messageTarget,
            t(I18nKey.interactionCommonImageUploadFailedRetry),
        );
        return null;
    }
};

// ---------------------------------------------------------------------------
// 上传待处理裁剪图片
// ---------------------------------------------------------------------------

function buildUploadTitleBase(
    pending: PendingCropEntry,
    rowIndex: number,
    sequence: string,
): string {
    if (pending.useSequentialName && rowIndex >= 0) {
        return `${pending.titlePrefix}-${sequence}`;
    }
    if (pending.useFixedName) {
        return pending.titlePrefix;
    }
    return `${pending.titlePrefix}-${Date.now()}`;
}

export const uploadPendingCropImages = async (
    msgId: string,
    pendingCount: number,
    totalSteps: number,
    update: UpdateFn,
): Promise<boolean> => {
    let doneSteps = 0;

    for (const [row, pending] of pendingCropBlobs) {
        update({
            mode: pendingCount > 0 ? "determinate" : "indeterminate",
            text: t(I18nKey.interactionCommonImageUploading),
            percent:
                pendingCount > 0
                    ? Math.round((doneSteps / totalSteps) * 100)
                    : undefined,
        });
        const rowSiblings = pending.container
            ? [...pending.container.children].filter(
                  (child) => (child as HTMLElement).tagName !== "BUTTON",
              )
            : [];
        const rowIndex = rowSiblings.indexOf(row);
        const sequence = String(
            rowIndex >= 0 ? rowIndex + 1 : Date.now(),
        ).padStart(2, "0");
        const titleBase = buildUploadTitleBase(pending, rowIndex, sequence);
        const fileId = await uploadImageBlob(
            pending.blob,
            msgId,
            titleBase,
            pending.fileExt,
            pending.targetFormat,
            pending.purpose,
        );
        if (!fileId) {
            setMsg(msgId, t(I18nKey.adminSiteSettingsUploadFailedCanceled));
            return false;
        }
        row.dataset.src = fileId;
        const preview = row.querySelector("img");
        if (preview) {
            updateImagePreview(preview as HTMLImageElement, fileId);
        }
        const srcInput = row.querySelector(
            'input[type="text"]',
        ) as HTMLInputElement | null;
        if (srcInput) {
            srcInput.value = fileId;
        }
        URL.revokeObjectURL(pending.objectUrl);
        pendingCropBlobs.delete(row);
        doneSteps += 1;
    }

    return true;
};
