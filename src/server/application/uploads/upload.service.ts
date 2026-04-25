import sharp from "sharp";

import type { UploadPurpose } from "@/constants/upload-limits";
import { UPLOAD_LIMIT_LABELS, UPLOAD_LIMITS } from "@/constants/upload-limits";
import { assertCan } from "@/server/auth/acl";
import { fail } from "@/server/api/response";
import {
    validateFileMagicBytes,
    validateImageDimensions,
} from "@/server/security/file-validation";
import { sanitizeImage } from "@/server/security/image-sanitize";
import { uploadManagedFile } from "@/server/repositories/uploads/upload.repository";
import type { AppAccess } from "@/server/api/v1/shared/types";

const VALID_PURPOSES = new Set<string>(Object.keys(UPLOAD_LIMITS));

type ProcessedUpload =
    | {
          ok: true;
          file: {
              buffer: Buffer;
              fileName: string;
              mime: string;
          };
      }
    | {
          ok: false;
          response: Response;
      };

function failWhenProcessedFileTooLarge(
    buffer: Buffer,
    purpose: UploadPurpose,
): Response | null {
    const maxSize = UPLOAD_LIMITS[purpose];
    if (buffer.length <= maxSize) {
        return null;
    }

    const label = UPLOAD_LIMIT_LABELS[purpose];
    return fail(`处理后的文件过大，最大允许 ${label}`, 413);
}

function toIcoBufferFromPngBuffer(pngBuffer: Buffer): Buffer {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);

    const directoryEntry = Buffer.alloc(16);
    directoryEntry.writeUInt8(0, 0);
    directoryEntry.writeUInt8(0, 1);
    directoryEntry.writeUInt8(0, 2);
    directoryEntry.writeUInt8(0, 3);
    directoryEntry.writeUInt16LE(1, 4);
    directoryEntry.writeUInt16LE(32, 6);
    directoryEntry.writeUInt32LE(pngBuffer.length, 8);
    directoryEntry.writeUInt32LE(6 + 16, 12);

    return Buffer.concat([header, directoryEntry, pngBuffer]);
}

async function convertBufferToIco(inputBuffer: Buffer): Promise<Buffer> {
    const pngBuffer = await sharp(inputBuffer)
        .resize(256, 256, { fit: "cover" })
        .png()
        .toBuffer();
    return Buffer.from(toIcoBufferFromPngBuffer(pngBuffer));
}

function convertPurpose(rawPurpose: string): UploadPurpose {
    if (rawPurpose === "cover") {
        return "article-cover";
    }
    if (rawPurpose === "inline") {
        return "general";
    }
    return rawPurpose as UploadPurpose;
}

export function resolveUploadPurpose(
    raw: FormDataEntryValue | null,
): UploadPurpose {
    if (typeof raw === "string") {
        const normalized = raw.trim();
        if (VALID_PURPOSES.has(convertPurpose(normalized))) {
            return convertPurpose(normalized);
        }
    }
    return "general";
}

async function processUploadBuffer(params: {
    initialBuffer: Buffer;
    file: File;
    purpose: UploadPurpose;
    targetFormat: string;
}): Promise<ProcessedUpload> {
    const magic = validateFileMagicBytes(params.initialBuffer, params.purpose);
    if (!magic.valid) {
        return {
            ok: false,
            response: fail("不支持的文件类型", 400, "UNSUPPORTED_FILE_TYPE"),
        };
    }

    const dims = await validateImageDimensions(
        params.initialBuffer,
        params.purpose,
        magic.detectedMime,
    );
    if (!dims.valid) {
        return {
            ok: false,
            response: fail(
                dims.message || "图片尺寸过大",
                400,
                "IMAGE_TOO_LARGE",
            ),
        };
    }

    let sanitized: Buffer;
    try {
        sanitized = Buffer.from(
            await sanitizeImage(params.initialBuffer, magic.detectedMime),
        );
    } catch {
        return {
            ok: false,
            response: fail("图片处理失败，请检查文件是否损坏", 422),
        };
    }

    if (params.targetFormat === "ico") {
        try {
            const converted = Buffer.from(await convertBufferToIco(sanitized));
            const baseName =
                params.file.name.replace(/\.[^/.]+$/u, "") || "favicon";
            const sizeError = failWhenProcessedFileTooLarge(
                converted,
                params.purpose,
            );
            if (sizeError) {
                return {
                    ok: false,
                    response: sizeError,
                };
            }
            return {
                ok: true,
                file: {
                    buffer: converted,
                    fileName: `${baseName}.ico`,
                    mime: "image/x-icon",
                },
            };
        } catch (error) {
            console.error(
                "[uploads/service] favicon ico conversion failed",
                error,
            );
            return {
                ok: false,
                response: fail("站点图标转换失败", 400),
            };
        }
    }

    const sizeError = failWhenProcessedFileTooLarge(sanitized, params.purpose);
    if (sizeError) {
        return {
            ok: false,
            response: sizeError,
        };
    }

    return {
        ok: true,
        file: {
            buffer: sanitized,
            fileName: params.file.name,
            mime: magic.detectedMime!,
        },
    };
}

export type UploadAuthorization =
    | {
          purpose: "registration-avatar";
          ownerUserId: string | null;
      }
    | {
          purpose: Exclude<UploadPurpose, "registration-avatar">;
          ownerUserId: string;
          access: AppAccess;
          accessToken: string;
      };

/**
 * 上传应用层统一托管文件校验、图片清洗和 Directus 写入编排。
 */
export async function createManagedUpload(params: {
    authorization: UploadAuthorization;
    file: File;
    targetFormat: string;
    requestedTitle: string;
    folder?: string;
}): Promise<
    | Response
    | { file: { id: string; title?: string; filename_download?: string } }
> {
    const maxSize = UPLOAD_LIMITS[params.authorization.purpose];
    const label = UPLOAD_LIMIT_LABELS[params.authorization.purpose];
    if (params.file.size > maxSize) {
        return fail(`文件过大，最大允许 ${label}`, 413);
    }

    if (params.authorization.purpose !== "registration-avatar") {
        assertCan(params.authorization.access, "can_upload_files");
    }

    const rawBuffer = Buffer.from(await params.file.arrayBuffer());
    const processed = await processUploadBuffer({
        initialBuffer: rawBuffer,
        file: params.file,
        purpose: params.authorization.purpose,
        targetFormat: params.targetFormat,
    });
    if (!processed.ok) {
        return processed.response;
    }

    const uploadFile = new File(
        [new Uint8Array(processed.file.buffer)],
        processed.file.fileName,
        {
            type: processed.file.mime,
        },
    );

    const uploaded = await uploadManagedFile({
        purpose: params.authorization.purpose,
        file: uploadFile,
        title: params.requestedTitle || undefined,
        folder: params.folder,
        ownerUserId: params.authorization.ownerUserId,
        accessToken:
            params.authorization.purpose === "registration-avatar"
                ? undefined
                : params.authorization.accessToken,
    });

    return {
        file: uploaded,
    };
}
