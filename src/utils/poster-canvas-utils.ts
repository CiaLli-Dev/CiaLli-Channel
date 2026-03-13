/** 解析后的日期结构 */
export type DateObj = { day: string; month: string; year: string };

/** Canvas 布局尺寸 */
export type LayoutDimensions = {
    coverHeight: number;
    titleFontSize: number;
    descFontSize: number;
    qrSize: number;
    footerHeight: number;
    titleLines: string[];
    titleLineHeight: number;
    titleHeight: number;
    descHeight: number;
    canvasHeight: number;
};

/** 海报素材 */
export type PosterAssets = {
    qrImg: HTMLImageElement | null;
    coverImg: HTMLImageElement | null;
    avatarImg: HTMLImageElement | null;
};

/**
 * 按最大宽度将文本切割为多行。
 */
export function getLines(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
): string[] {
    const lines: string[] = [];
    let currentLine = "";

    for (const char of text) {
        if (ctx.measureText(currentLine + char).width < maxWidth) {
            currentLine += char;
        } else {
            lines.push(currentLine);
            currentLine = char;
        }
    }

    if (currentLine) lines.push(currentLine);
    return lines;
}

/**
 * 在 Canvas 上绘制圆角矩形路径（需调用方自行 fill/stroke）。
 */
export function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * 将日期字符串解析为 DateObj，解析失败返回 null。
 */
export function parseDate(dateStr: string): DateObj | null {
    try {
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return null;

        return {
            day: d.getDate().toString().padStart(2, "0"),
            month: (d.getMonth() + 1).toString().padStart(2, "0"),
            year: d.getFullYear().toString(),
        };
    } catch {
        return null;
    }
}

/**
 * 加载图片，支持通过 weserv 代理重试。
 */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";

        img.onload = () => resolve(img);
        img.onerror = () => {
            if (src.includes("images.weserv.nl") || src.startsWith("data:")) {
                resolve(null);
                return;
            }

            const proxyImg = new Image();
            proxyImg.crossOrigin = "anonymous";
            proxyImg.onload = () => resolve(proxyImg);
            proxyImg.onerror = () => resolve(null);
            proxyImg.src = `https://images.weserv.nl/?url=${encodeURIComponent(src)}&output=png`;
        };

        img.src = src;
    });
}
