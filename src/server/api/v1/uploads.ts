import type { APIContext } from "astro";
import sharp from "sharp";

import type { UploadPurpose } from "@/constants/upload-limits";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@/constants/upload-limits";
import { assertCan } from "@/server/auth/acl";
import { getSessionUser } from "@/server/auth/session";
import {
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
    if (typeof raw === "string" && VALID_PURPOSES.has(raw)) {
        return raw as UploadPurpose;
    }
    return "general";
}

export async function handleUploads(context: APIContext): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }

    // 1. formData 解析 + purpose 解析
    const formData = await context.request.formData();
    const purpose = resolvePurpose(formData.get("purpose"));
    let ownerUserId: string | null;

    // 2. ACL 校验
    if (purpose !== "registration-avatar") {
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        const access = required.access;
        assertCan(access, "can_upload_files");
        ownerUserId = access.user.id;
    } else {
        const ip = getClientIp(context.request.headers);
        const rateResult = await applyRateLimit(ip, "upload");
        if (!rateResult.ok) {
            return rateLimitResponse(rateResult);
        }
        const sessionUser = await getSessionUser(context);
        ownerUserId = sessionUser?.id || null;
    }

    // 3. 文件存在性检查
    const file = formData.get("file");
    if (!(file instanceof File)) {
        return fail("缺少上传文件", 400);
    }

    const targetFormatRaw = formData.get("target_format");
    const targetFormat =
        typeof targetFormatRaw === "string" ? targetFormatRaw : "";

    // 4. 文件大小限制检查
    const maxSize = UPLOAD_LIMITS[purpose];
    const label = UPLOAD_LIMIT_LABELS[purpose];
    if (file.size > maxSize) {
        return fail(`文件过大，最大允许 ${label}`, 413);
    }

    // 5. 读取 buffer
    let buffer = Buffer.from(await file.arrayBuffer());

    // 6. 魔数校验
    const magic = validateFileMagicBytes(buffer, purpose);
    if (!magic.valid) {
        return fail("不支持的文件类型", 400, "UNSUPPORTED_FILE_TYPE");
    }

    // 7. 图片尺寸校验
    const dims = await validateImageDimensions(buffer, purpose);
    if (!dims.valid) {
        return fail(dims.message || "图片尺寸过大", 400, "IMAGE_TOO_LARGE");
    }

    // 8. EXIF/GPS 清理
    buffer = Buffer.from(await sanitizeImage(buffer, magic.detectedMime));

    // 9. ICO 转换
    let uploadFileName = file.name;
    let uploadMime = file.type;
    if (targetFormat === "ico") {
        try {
            buffer = Buffer.from(await convertBufferToIco(buffer));
            const baseName = file.name.replace(/\.[^/.]+$/u, "") || "favicon";
            uploadFileName = `${baseName}.ico`;
            uploadMime = "image/x-icon";
        } catch (error) {
            console.error("[uploads] favicon ico conversion failed", error);
            return fail("站点图标转换失败", 400);
        }
        if (buffer.length > maxSize) {
            return fail(`站点图标过大，最大允许 ${label}`, 413);
        }
    }

    // 10. 重建 File 对象 → uploadDirectusFile
    const uploadFile = new File([new Uint8Array(buffer)], uploadFileName, {
        type: uploadMime,
    });

    const titleRaw = formData.get("title");
    const folderRaw = formData.get("folder");
    const requestedTitle = typeof titleRaw === "string" ? titleRaw.trim() : "";
    const uploaded = await uploadDirectusFile({
        file: uploadFile,
        title: requestedTitle || undefined,
        folder: typeof folderRaw === "string" ? folderRaw : undefined,
    });
    if (uploaded.id && (requestedTitle || ownerUserId)) {
        await updateDirectusFileMetadata(uploaded.id, {
            title: requestedTitle || undefined,
            uploaded_by: ownerUserId,
        });
    }
    return ok({ file: uploaded });
}
