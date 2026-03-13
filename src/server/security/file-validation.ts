/**
 * 上传文件校验：魔数（magic bytes）+ 图片尺寸
 */
import sharp from "sharp";

import type { UploadPurpose } from "@/constants/upload-limits";

// ---- 魔数签名表 ----

type MimeSignature = {
    mime: string;
    /** 偏移量 */
    offset: number;
    /** 匹配字节序列 */
    bytes: number[];
};

const SIGNATURES: MimeSignature[] = [
    { mime: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
    { mime: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
    { mime: "image/gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
    // WebP: starts with RIFF....WEBP
    { mime: "image/webp", offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    // ICO: 00 00 01 00
    {
        mime: "image/x-icon",
        offset: 0,
        bytes: [0x00, 0x00, 0x01, 0x00],
    },
    // AVIF: ftyp box — 字节 4-7 为 "ftyp"
    { mime: "image/avif", offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
];

/** 各 purpose 允许的 MIME 类型 */
const ALLOWED_MIMES: Record<UploadPurpose, Set<string>> = {
    avatar: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
    "registration-avatar": new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    ]),
    favicon: new Set(["image/png", "image/jpeg", "image/x-icon"]),
    banner: new Set(["image/jpeg", "image/png", "image/webp"]),
    "diary-image": new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/avif",
    ]),
    "album-photo": new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/avif",
    ]),
    "article-cover": new Set(["image/jpeg", "image/png", "image/webp"]),
    general: new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/avif",
    ]),
};

function detectMime(header: Uint8Array): string | null {
    for (const sig of SIGNATURES) {
        const end = sig.offset + sig.bytes.length;
        if (header.length < end) continue;
        let match = true;
        for (let i = 0; i < sig.bytes.length; i++) {
            if (header[sig.offset + i] !== sig.bytes[i]) {
                match = false;
                break;
            }
        }
        if (match) return sig.mime;
    }
    return null;
}

export function validateFileMagicBytes(
    buffer: Buffer,
    purpose: UploadPurpose,
): { valid: boolean; detectedMime: string | null } {
    const header = new Uint8Array(
        buffer.buffer,
        buffer.byteOffset,
        Math.min(buffer.length, 16),
    );
    const detectedMime = detectMime(header);
    if (!detectedMime) return { valid: false, detectedMime: null };
    const allowed = ALLOWED_MIMES[purpose];
    return { valid: allowed.has(detectedMime), detectedMime };
}

// ---- 图片尺寸校验 ----

type DimensionLimit = { maxWidth: number; maxHeight: number };

const DIMENSION_LIMITS: Record<UploadPurpose, DimensionLimit> = {
    avatar: { maxWidth: 4096, maxHeight: 4096 },
    "registration-avatar": { maxWidth: 4096, maxHeight: 4096 },
    favicon: { maxWidth: 4096, maxHeight: 4096 },
    banner: { maxWidth: 8192, maxHeight: 4096 },
    "diary-image": { maxWidth: 16384, maxHeight: 16384 },
    "album-photo": { maxWidth: 16384, maxHeight: 16384 },
    "article-cover": { maxWidth: 8192, maxHeight: 8192 },
    general: { maxWidth: 16384, maxHeight: 16384 },
};

export async function validateImageDimensions(
    buffer: Buffer,
    purpose: UploadPurpose,
): Promise<{ valid: boolean; message?: string }> {
    const limit = DIMENSION_LIMITS[purpose];
    try {
        const metadata = await sharp(buffer).metadata();
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        if (width > limit.maxWidth || height > limit.maxHeight) {
            return {
                valid: false,
                message: `图片尺寸过大（${width}×${height}），最大允许 ${limit.maxWidth}×${limit.maxHeight}`,
            };
        }
        return { valid: true };
    } catch {
        // sharp 无法解析的文件（如 ICO），跳过尺寸检查
        return { valid: true };
    }
}
