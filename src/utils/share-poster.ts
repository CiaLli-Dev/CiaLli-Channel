import QRCode from "qrcode";

import {
    type LayoutDimensions,
    type PosterAssets,
    drawRoundedRect,
    getLines,
    loadImage,
    parseDate,
} from "@utils/poster-canvas-utils";

export type SharePosterPayload = {
    title: string;
    author: string;
    description: string;
    pubDate: string;
    coverImage: string | null;
    url: string;
    siteTitle: string;
    avatar: string | null;
    hiddenUntilDecrypt?: boolean;
};

export type SharePosterRenderOptions = {
    themeColor?: string;
    authorLabel?: string;
    scanLabel?: string;
};

const SCALE = 2;
const WIDTH = 425 * SCALE;
const PADDING = 24 * SCALE;
const CONTENT_WIDTH = WIDTH - PADDING * 2;
const FONT_FAMILY = '"Noto Sans SC", "Noto Sans JP", sans-serif';
const DEFAULT_THEME_COLOR = "#558e88";
const FOOTER_BOTTOM_PADDING = 18 * SCALE;

async function ensurePosterFontsReady(): Promise<void> {
    if (typeof document === "undefined" || !("fonts" in document)) {
        return;
    }

    const fontLoads = [
        '400 16px "Noto Sans SC"',
        '700 16px "Noto Sans SC"',
        '400 16px "Noto Sans JP"',
        '700 16px "Noto Sans JP"',
    ];

    await Promise.allSettled(
        fontLoads.map((fontDescriptor) => document.fonts.load(fontDescriptor)),
    );
}

function getPosterTitle(payload: SharePosterPayload): string {
    return payload.title.trim() || payload.siteTitle.trim() || "CiaLli";
}

function getPosterAuthor(payload: SharePosterPayload): string {
    return payload.author.trim() || payload.siteTitle.trim() || "CiaLli";
}

function getPosterDescription(payload: SharePosterPayload): string {
    return payload.description.trim();
}

async function loadPosterAssets(
    payload: SharePosterPayload,
    qrCodeUrl: string,
): Promise<PosterAssets> {
    const [qrImg, coverImg, avatarImg] = await Promise.all([
        loadImage(qrCodeUrl),
        payload.coverImage
            ? loadImage(payload.coverImage)
            : Promise.resolve(null),
        payload.avatar ? loadImage(payload.avatar) : Promise.resolve(null),
    ]);

    return {
        qrImg,
        coverImg,
        avatarImg,
    };
}

function computeLayout(
    ctx: CanvasRenderingContext2D,
    payload: SharePosterPayload,
): LayoutDimensions {
    const coverHeight = (payload.coverImage ? 200 : 120) * SCALE;
    const titleFontSize = 24 * SCALE;
    const descFontSize = 14 * SCALE;
    const qrSize = 80 * SCALE;
    const footerHeight = qrSize;
    const posterTitle = getPosterTitle(payload);
    const posterDescription = getPosterDescription(payload);

    ctx.font = `700 ${titleFontSize}px ${FONT_FAMILY}`;
    const titleLines = getLines(ctx, posterTitle, CONTENT_WIDTH);
    const titleLineHeight = 30 * SCALE;
    const titleHeight = titleLines.length * titleLineHeight;

    let descHeight = 0;
    if (posterDescription) {
        ctx.font = `${descFontSize}px ${FONT_FAMILY}`;
        const descLines = getLines(
            ctx,
            posterDescription,
            CONTENT_WIDTH - 16 * SCALE,
        );
        descHeight = Math.min(descLines.length, 6) * (25 * SCALE);
    }

    const canvasHeight =
        coverHeight +
        PADDING +
        titleHeight +
        16 * SCALE +
        descHeight +
        (posterDescription ? 24 * SCALE : 8 * SCALE) +
        24 * SCALE +
        footerHeight +
        FOOTER_BOTTOM_PADDING;

    return {
        coverHeight,
        titleFontSize,
        descFontSize,
        qrSize,
        footerHeight,
        titleLines,
        titleLineHeight,
        titleHeight,
        descHeight,
        canvasHeight,
    };
}

function drawBackground(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    themeColor: string,
): void {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = themeColor;
    ctx.beginPath();
    ctx.arc(canvasWidth - 25 * SCALE, 25 * SCALE, 75 * SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(10 * SCALE, canvasHeight - 10 * SCALE, 50 * SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawCoverImage(
    ctx: CanvasRenderingContext2D,
    payload: SharePosterPayload,
    coverImg: HTMLImageElement | null,
    coverHeight: number,
    themeColor: string,
): void {
    if (coverImg) {
        const imgRatio = coverImg.width / coverImg.height;
        const targetRatio = WIDTH / coverHeight;
        let sx: number;
        let sy: number;
        let sWidth: number;
        let sHeight: number;

        if (imgRatio > targetRatio) {
            sHeight = coverImg.height;
            sWidth = sHeight * targetRatio;
            sx = (coverImg.width - sWidth) / 2;
            sy = 0;
        } else {
            sWidth = coverImg.width;
            sHeight = sWidth / targetRatio;
            sx = 0;
            sy = (coverImg.height - sHeight) / 2;
        }

        ctx.drawImage(
            coverImg,
            sx,
            sy,
            sWidth,
            sHeight,
            0,
            0,
            WIDTH,
            coverHeight,
        );
        return;
    }

    if (!payload.coverImage) {
        ctx.save();
        ctx.fillStyle = themeColor;
        ctx.globalAlpha = 0.2;
        ctx.fillRect(0, 0, WIDTH, coverHeight);
        ctx.restore();
    }
}

function drawDateBadge(
    ctx: CanvasRenderingContext2D,
    payload: SharePosterPayload,
    coverHeight: number,
): void {
    const dateObj = parseDate(payload.pubDate);
    if (!dateObj) {
        return;
    }

    const dateBoxW = 60 * SCALE;
    const dateBoxH = 60 * SCALE;
    const dateBoxX = PADDING;
    const dateBoxY = coverHeight - dateBoxH;

    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    drawRoundedRect(ctx, dateBoxX, dateBoxY, dateBoxW, dateBoxH, 4 * SCALE);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${30 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(dateObj.day, dateBoxX + dateBoxW / 2, dateBoxY + 24 * SCALE);

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = SCALE;
    ctx.moveTo(dateBoxX + 10 * SCALE, dateBoxY + 42 * SCALE);
    ctx.lineTo(dateBoxX + dateBoxW - 10 * SCALE, dateBoxY + 42 * SCALE);
    ctx.stroke();

    ctx.font = `${10 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(
        `${dateObj.year} ${dateObj.month}`,
        dateBoxX + dateBoxW / 2,
        dateBoxY + 51 * SCALE,
    );
}

function drawTitleAndDescription(
    ctx: CanvasRenderingContext2D,
    payload: SharePosterPayload,
    layout: LayoutDimensions,
    startY: number,
): number {
    const { titleFontSize, descFontSize, titleLines, titleLineHeight } = layout;
    const posterDescription = getPosterDescription(payload);
    let drawY = startY;

    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = `700 ${titleFontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = "#111827";
    for (const line of titleLines) {
        ctx.fillText(line, PADDING, drawY);
        drawY += titleLineHeight;
    }
    drawY += 16 * SCALE - (titleLineHeight - titleFontSize);

    if (!posterDescription) {
        return drawY + 8 * SCALE;
    }

    // 简介换行必须基于正文小字号测宽，不能沿用标题字号，否则会提前断行。
    ctx.font = `${descFontSize}px ${FONT_FAMILY}`;
    const descLines = getLines(
        ctx,
        posterDescription,
        CONTENT_WIDTH - 16 * SCALE,
    );
    const descHeight = Math.min(descLines.length, 6) * (25 * SCALE);

    ctx.fillStyle = "#e5e7eb";
    drawRoundedRect(
        ctx,
        PADDING,
        drawY - 8 * SCALE,
        4 * SCALE,
        descHeight + 8 * SCALE,
        2 * SCALE,
    );
    ctx.fill();

    ctx.font = `${descFontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = "#4b5563";
    for (const line of descLines.slice(0, 6)) {
        ctx.fillText(line, PADDING + 16 * SCALE, drawY);
        drawY += 25 * SCALE;
    }

    return drawY;
}

function drawDivider(ctx: CanvasRenderingContext2D, y: number): number {
    const drawY = y + 24 * SCALE;
    ctx.beginPath();
    ctx.strokeStyle = "#f3f4f6";
    ctx.lineWidth = SCALE;
    ctx.moveTo(PADDING, drawY);
    ctx.lineTo(WIDTH - PADDING, drawY);
    ctx.stroke();
    return drawY + 16 * SCALE;
}

function drawQrCode(
    ctx: CanvasRenderingContext2D,
    qrImg: HTMLImageElement | null,
    qrSize: number,
    footerY: number,
): void {
    const qrX = WIDTH - PADDING - qrSize;

    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.05)";
    ctx.shadowBlur = 4 * SCALE;
    ctx.shadowOffsetY = 2 * SCALE;
    drawRoundedRect(ctx, qrX, footerY, qrSize, qrSize, 4 * SCALE);
    ctx.fill();
    ctx.shadowColor = "transparent";

    if (!qrImg) {
        return;
    }

    const qrInnerSize = 76 * SCALE;
    const qrPadding = (qrSize - qrInnerSize) / 2;
    ctx.drawImage(
        qrImg,
        qrX + qrPadding,
        footerY + qrPadding,
        qrInnerSize,
        qrInnerSize,
    );
}

function drawAvatar(
    ctx: CanvasRenderingContext2D,
    avatarImg: HTMLImageElement | null,
    footerY: number,
): void {
    if (!avatarImg) {
        return;
    }

    ctx.save();
    const avatarSize = 64 * SCALE;
    const avatarX = PADDING;
    ctx.beginPath();
    ctx.arc(
        avatarX + avatarSize / 2,
        footerY + avatarSize / 2,
        avatarSize / 2,
        0,
        Math.PI * 2,
    );
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX, footerY, avatarSize, avatarSize);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(
        avatarX + avatarSize / 2,
        footerY + avatarSize / 2,
        avatarSize / 2,
        0,
        Math.PI * 2,
    );
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * SCALE;
    ctx.stroke();
}

function drawAuthorInfo(
    ctx: CanvasRenderingContext2D,
    payload: SharePosterPayload,
    footerY: number,
    options: SharePosterRenderOptions,
): void {
    const avatarOffset = payload.avatar ? 64 * SCALE + 16 * SCALE : 0;
    const textX = PADDING + avatarOffset;

    ctx.fillStyle = "#9ca3af";
    ctx.font = `${12 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(options.authorLabel || "Author", textX, footerY + 4 * SCALE);

    ctx.fillStyle = "#1f2937";
    ctx.font = `700 ${16 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(getPosterAuthor(payload), textX, footerY + 20 * SCALE);

    ctx.fillStyle = "#9ca3af";
    ctx.font = `${12 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(
        options.scanLabel || "Scan to Read",
        textX,
        footerY + 44 * SCALE,
    );

    ctx.fillStyle = "#1f2937";
    ctx.font = `700 ${15 * SCALE}px ${FONT_FAMILY}`;
    ctx.fillText(
        payload.siteTitle.trim() || "CiaLli",
        textX,
        footerY + 60 * SCALE,
    );
}

export function resolveShareThemeColor(): string {
    const temp = document.createElement("div");
    temp.style.color = "var(--primary)";
    temp.style.display = "none";
    document.body.appendChild(temp);
    const computedColor = getComputedStyle(temp).color;
    document.body.removeChild(temp);
    return computedColor || DEFAULT_THEME_COLOR;
}

/**
 * 统一生成分享海报，避免多个入口各自维护一套 Canvas 绘制逻辑。
 */
export async function generateSharePosterImage(
    payload: SharePosterPayload,
    options: SharePosterRenderOptions = {},
): Promise<string> {
    await ensurePosterFontsReady();

    const themeColor = options.themeColor || DEFAULT_THEME_COLOR;
    const qrCodeUrl = await QRCode.toDataURL(payload.url, {
        margin: 1,
        width: 100 * SCALE,
        color: { dark: "#000000", light: "#ffffff" },
    });
    const { qrImg, coverImg, avatarImg } = await loadPosterAssets(
        payload,
        qrCodeUrl,
    );

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Canvas context not available");
    }

    const layout = computeLayout(ctx, payload);
    canvas.width = WIDTH;
    canvas.height = layout.canvasHeight;

    drawBackground(ctx, canvas.width, canvas.height, themeColor);
    drawCoverImage(ctx, payload, coverImg, layout.coverHeight, themeColor);
    drawDateBadge(ctx, payload, layout.coverHeight);

    const afterTitle = drawTitleAndDescription(
        ctx,
        payload,
        layout,
        layout.coverHeight + PADDING,
    );
    const footerY = drawDivider(ctx, afterTitle);

    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    drawQrCode(ctx, qrImg, layout.qrSize, footerY);
    drawAvatar(ctx, avatarImg, footerY);
    drawAuthorInfo(ctx, payload, footerY, options);

    return canvas.toDataURL("image/png");
}

function toSafeFileNameSegment(input: string): string {
    const normalized = input
        .trim()
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return normalized || "poster";
}

export function downloadSharePosterImage(
    posterImage: string,
    fileNameBase: string,
): void {
    const link = document.createElement("a");
    link.href = posterImage;
    link.download = `${toSafeFileNameSegment(fileNameBase)}-poster.png`;
    link.click();
}

export async function copyTextToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    throw new Error("Clipboard API is unavailable in the current context.");
}
