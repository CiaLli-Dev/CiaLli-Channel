import type { APIContext } from "astro";
import sharp from "sharp";

import type { UploadPurpose } from "@/constants/upload-limits";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@/constants/upload-limits";
import { assertCan } from "@/server/auth/acl";
import { getSessionUser } from "@/server/auth/session";
import {
    runWithDirectusServiceAccess,
    runWithDirectusUserAccess,
    uploadDirectusFile,
    updateDirectusFileMetadata,
} from "@/server/directus/client";
import { getClientIp } from "@/server/directus-auth";
import { fail, ok } from "@/server/api/response";
import {
    validateFileMagicBytes,
    validateImageDimensions,
} from "@/server/security/file-validation";
import { sanitizeImage } from "@/server/security/image-sanitize";
import {
    applyRateLimit,
    rateLimitResponse,
} from "@/server/security/rate-limit";

import { requireAccess } from "./shared";

const VALID_PURPOSES = new Set<string>(Object.keys(UPLOAD_LIMITS));

function toIcoBufferFromPngBuffer(pngBuffer: Buffer): Buffer {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(1, 4); // image count

    const directoryEntry = Buffer.alloc(16);
    directoryEntry.writeUInt8(0, 0); // width: 256
    directoryEntry.writeUInt8(0, 1); // height: 256
    directoryEntry.writeUInt8(0, 2); // color count
    directoryEntry.writeUInt8(0, 3); // reserved
    directoryEntry.writeUInt16LE(1, 4); // color planes
    directoryEntry.writeUInt16LE(32, 6); // bits per pixel
    directoryEntry.writeUInt32LE(pngBuffer.length, 8); // image bytes
    directoryEntry.writeUInt32LE(6 + 16, 12); // offset

    return Buffer.concat([header, directoryEntry, pngBuffer]);
}

async function convertBufferToIco(inputBuffer: Buffer): Promise<Buffer> {
    const pngBuffer = await sharp(inputBuffer)
        .resize(256, 256, { fit: "cover" })
        .png()
        .toBuffer();
    return Buffer.from(toIcoBufferFromPngBuffer(pngBuffer));
}

function resolvePurpose(raw: FormDataEntryValue | null): UploadPurpose {
    if (typeof raw === "string") {
        const normalized = raw.trim();
        if (normalized === "cover") {
            return "article-cover";
        }
        if (normalized === "inline") {
            return "general";
        }
        if (VALID_PURPOSES.has(normalized)) {
            return normalized as UploadPurpose;
        }
    }
    return "general";
}

function resolveInitialFileVisibility(
    purpose: UploadPurpose,
): "private" | "public" {
    if (purpose === "avatar") {
        return "private";
    }
    return "public";
}

type OwnerResolution = { ownerUserId: string | null } | { response: Response };

async function resolveOwner(
    context: APIContext,
    purpose: UploadPurpose,
): Promise<OwnerResolution> {
    if (purpose !== "registration-avatar") {
        const required = await requireAccess(context);
        if ("response" in required) {
            return required;
        }
        const access = required.access;
        assertCan(access, "can_upload_files");
        return { ownerUserId: access.user.id };
    }

    const ip = getClientIp(context.request.headers);
    const rateResult = await applyRateLimit(ip, "upload");
    if (!rateResult.ok) {
        return { response: rateLimitResponse(rateResult) };
    }
    const sessionUser = await getSessionUser(context);
    return { ownerUserId: sessionUser?.id || null };
}

type IcoConversionResult =
    | { buffer: Buffer; fileName: string; mime: string }
    | { response: Response };

async function convertToIco(
    inputBuffer: Buffer,
    originalName: string,
    maxSize: number,
    label: string,
): Promise<IcoConversionResult> {
    try {
        const converted = Buffer.from(await convertBufferToIco(inputBuffer));
        const baseName = originalName.replace(/\.[^/.]+$/u, "") || "favicon";
        if (converted.length > maxSize) {
            return { response: fail(`站点图标过大，最大允许 ${label}`, 413) };
        }
        return {
            buffer: converted,
            fileName: `${baseName}.ico`,
            mime: "image/x-icon",
        };
    } catch (error) {
        console.error("[uploads] favicon ico conversion failed", error);
        return { response: fail("站点图标转换失败", 400) };
    }
}

type BufferProcessResult =
    | { buffer: Buffer; fileName: string; mime: string }
    | { response: Response };

async function processUploadBuffer(
    initialBuffer: Buffer,
    file: File,
    purpose: UploadPurpose,
    targetFormat: string,
): Promise<BufferProcessResult> {
    const maxSize = UPLOAD_LIMITS[purpose];
    const label = UPLOAD_LIMIT_LABELS[purpose];

    const magic = validateFileMagicBytes(initialBuffer, purpose);
    if (!magic.valid) {
        return {
            response: fail("不支持的文件类型", 400, "UNSUPPORTED_FILE_TYPE"),
        };
    }

    const dims = await validateImageDimensions(initialBuffer, purpose);
    if (!dims.valid) {
        return {
            response: fail(
                dims.message || "图片尺寸过大",
                400,
                "IMAGE_TOO_LARGE",
            ),
        };
    }

    const sanitized = Buffer.from(
        await sanitizeImage(initialBuffer, magic.detectedMime),
    );

    if (targetFormat === "ico") {
        return convertToIco(sanitized, file.name, maxSize, label);
    }

    return { buffer: sanitized, fileName: file.name, mime: file.type };
}

export async function handleUploads(context: APIContext): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }

    const formData = await context.request.formData();
    const purpose = resolvePurpose(formData.get("purpose"));

    const ownerResolution = await resolveOwner(context, purpose);
    if ("response" in ownerResolution) {
        return ownerResolution.response;
    }
    const { ownerUserId } = ownerResolution;

    let userAccessToken = "";
    if (purpose !== "registration-avatar") {
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        userAccessToken = required.accessToken;
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
        return fail("缺少上传文件", 400);
    }

    const maxSize = UPLOAD_LIMITS[purpose];
    const label = UPLOAD_LIMIT_LABELS[purpose];
    if (file.size > maxSize) {
        return fail(`文件过大，最大允许 ${label}`, 413);
    }

    const targetFormatRaw = formData.get("target_format");
    const targetFormat =
        typeof targetFormatRaw === "string" ? targetFormatRaw : "";

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const processed = await processUploadBuffer(
        rawBuffer,
        file,
        purpose,
        targetFormat,
    );
    if ("response" in processed) {
        return processed.response;
    }

    const { buffer, fileName: uploadFileName, mime: uploadMime } = processed;
    const uploadFile = new File([new Uint8Array(buffer)], uploadFileName, {
        type: uploadMime,
    });

    const titleRaw = formData.get("title");
    const folderRaw = formData.get("folder");
    const requestedTitle = typeof titleRaw === "string" ? titleRaw.trim() : "";
    const uploadTask = async (): Promise<{
        id: string;
        title?: string;
        filename_download?: string;
    }> =>
        await uploadDirectusFile({
            file: uploadFile,
            title: requestedTitle || undefined,
            folder: typeof folderRaw === "string" ? folderRaw : undefined,
        });
    const uploaded =
        purpose === "registration-avatar"
            ? await runWithDirectusServiceAccess(uploadTask)
            : await runWithDirectusUserAccess(userAccessToken, uploadTask);
    if (uploaded.id && (requestedTitle || ownerUserId)) {
        const metadataTask = async (): Promise<void> => {
            await updateDirectusFileMetadata(uploaded.id, {
                title: requestedTitle || undefined,
                uploaded_by: ownerUserId,
                app_owner_user_id: ownerUserId,
                app_visibility: resolveInitialFileVisibility(purpose),
            });
        };
        if (purpose === "registration-avatar") {
            await runWithDirectusServiceAccess(metadataTask);
        } else {
            await runWithDirectusUserAccess(userAccessToken, metadataTask);
        }
    }
    return ok({ file: uploaded });
}
