/**
 * 图片 EXIF/GPS 清理
 *
 * 使用 Sharp 重新编码图片，自动应用 EXIF 旋转，
 * 输出时不保留任何元数据（包括 GPS 位置信息）。
 */
import sharp from "sharp";

/** 需要清理元数据的图片 MIME 类型 */
const SANITIZABLE_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
    "image/gif",
]);

/**
 * 清理图片元数据。对可识别的图片格式重新编码去除 EXIF/GPS；
 * 非图片或不可识别的格式直接返回原 buffer。
 */
export async function sanitizeImage(
    buffer: Buffer,
    detectedMime: string | null,
): Promise<Buffer> {
    if (!detectedMime || !SANITIZABLE_MIMES.has(detectedMime)) {
        return buffer;
    }

    try {
        // rotate() 不带参数 → 读取 EXIF Orientation 自动旋转，然后丢弃元数据
        const pipeline = sharp(buffer).rotate();

        let result: Buffer;
        switch (detectedMime) {
            case "image/jpeg":
                result = await pipeline.jpeg().toBuffer();
                break;
            case "image/png":
                result = await pipeline.png().toBuffer();
                break;
            case "image/webp":
                result = await pipeline.webp().toBuffer();
                break;
            case "image/avif":
                result = await pipeline.avif().toBuffer();
                break;
            case "image/gif":
                // GIF 动图 Sharp 默认只取第一帧，用 animated: true 保留所有帧
                result = await sharp(buffer, { animated: true })
                    .rotate()
                    .gif()
                    .toBuffer();
                break;
            default:
                return buffer;
        }
        return Buffer.from(result);
    } catch (error) {
        console.warn(
            "[image-sanitize] failed to sanitize, returning original:",
            error,
        );
        return buffer;
    }
}
