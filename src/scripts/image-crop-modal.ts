/**
 * 图片裁剪弹窗模块
 */

import I18nKey from "@i18n/i18nKey";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@constants/upload-limits";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { clamp } from "@/scripts/dom-helpers";

export interface CropModalConfig {
    outputWidth: number;
    outputHeight: number;
    outputMime?: string; // 默认 "image/jpeg"
    outputQuality?: number; // 默认 0.9
    zoomRange?: [number, number]; // [100, 300]
    maxFileSize?: number; // 字节；不传则使用 UPLOAD_LIMITS["article-cover"]
    title?: string;
}

// ── ImageCropModal ──

export class ImageCropModal {
    private readonly config: Required<
        Pick<
            CropModalConfig,
            | "outputWidth"
            | "outputHeight"
            | "outputMime"
            | "outputQuality"
            | "maxFileSize"
            | "title"
        >
    > & { zoomMin: number; zoomMax: number };

    // DOM
    private overlay: HTMLDivElement | null = null;
    private viewport: HTMLDivElement | null = null;
    private img: HTMLImageElement | null = null;
    private emptyHint: HTMLParagraphElement | null = null;
    private fileInput: HTMLInputElement | null = null;
    private zoomInput: HTMLInputElement | null = null;
    private applyBtn: HTMLButtonElement | null = null;
    private msgEl: HTMLParagraphElement | null = null;

    // 状态
    private objectUrl = "";
    private loaded = false;
    private imageWidth = 0;
    private imageHeight = 0;
    private vpWidth = 0;
    private vpHeight = 0;
    private minScale = 1;
    private scale = 1;
    private offsetX = 0;
    private offsetY = 0;
    private pointerId: number | null = null;
    private pointerX = 0;
    private pointerY = 0;
    private processing = false;

    // Promise 控制
    private resolve: ((blob: Blob | null) => void) | null = null;

    constructor(config: CropModalConfig) {
        const [zoomMin, zoomMax] = config.zoomRange ?? [100, 300];
        this.config = {
            outputWidth: config.outputWidth,
            outputHeight: config.outputHeight,
            outputMime: config.outputMime ?? "image/jpeg",
            outputQuality: config.outputQuality ?? 0.9,
            maxFileSize: config.maxFileSize ?? UPLOAD_LIMITS["article-cover"],
            title: config.title ?? t(I18nKey.interactionCommonCropImage),
            zoomMin,
            zoomMax,
        };
    }

    // ── 公开 API ──

    open(): Promise<Blob | null> {
        return new Promise<Blob | null>((resolve) => {
            this.resolve = resolve;
            this.buildDom();
            this.showOverlay();
        });
    }

    destroy(): void {
        this.revokeObjectUrl();
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        document.body.classList.remove("overflow-hidden");
    }

    // ── DOM 构建 ──

    private buildDom(): void {
        if (this.overlay) return;

        const overlay = document.createElement("div");
        overlay.className = "overlay-dialog px-4";
        overlay.style.display = "none";
        overlay.tabIndex = -1;

        const card = document.createElement("div");
        card.className =
            "overlay-dialog-card overlay-dialog-card-crop w-full max-w-2xl border border-(--line-divider) text-75";
        card.style.textAlign = "left";

        const body = document.createElement("div");
        body.className = "overlay-dialog-body";

        // 标题
        const title = document.createElement("h3");
        title.className = "text-xl font-semibold text-90";
        title.textContent = this.config.title;
        body.appendChild(title);

        // 视口
        const viewport = document.createElement("div");
        viewport.className =
            "relative w-full overflow-hidden bg-black/10 dark:bg-white/10 rounded-lg touch-none select-none cursor-grab";
        const aspect =
            (this.config.outputHeight / this.config.outputWidth) * 100;
        viewport.style.paddingBottom = `${aspect}%`;

        const img = document.createElement("img");
        img.className =
            "absolute top-0 left-0 hidden pointer-events-none max-w-none";
        img.alt = t(I18nKey.interactionCommonCropPreviewAlt);
        img.draggable = false;

        const emptyHint = document.createElement("p");
        emptyHint.className =
            "absolute inset-0 flex items-center justify-center text-sm text-50";
        emptyHint.textContent = t(I18nKey.interactionCommonSelectImage);

        viewport.appendChild(img);
        viewport.appendChild(emptyHint);
        body.appendChild(viewport);

        // 控件行
        const controls = document.createElement("div");
        controls.className = "flex items-center gap-3";

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.className = "hidden";

        const selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.className =
            "px-4 h-9 rounded-lg text-sm font-medium transition cursor-pointer bg-(--btn-regular-bg) hover:bg-(--btn-regular-bg-hover) text-(--btn-content)";
        selectBtn.textContent = t(I18nKey.interactionCommonChooseFile);

        const zoomLabel = document.createElement("span");
        zoomLabel.className = "text-sm text-50 ml-auto";
        zoomLabel.textContent = t(I18nKey.interactionCommonZoom);

        const zoomInput = document.createElement("input");
        zoomInput.type = "range";
        zoomInput.min = String(this.config.zoomMin);
        zoomInput.max = String(this.config.zoomMax);
        zoomInput.value = String(this.config.zoomMin);
        zoomInput.className = "w-32";

        controls.appendChild(fileInput);
        controls.appendChild(selectBtn);
        controls.appendChild(zoomLabel);
        controls.appendChild(zoomInput);
        body.appendChild(controls);

        // 消息
        const msgEl = document.createElement("p");
        msgEl.className = "text-sm text-(--error-color) min-h-5";
        body.appendChild(msgEl);

        // 底部按钮
        const footer = document.createElement("div");
        footer.className = "overlay-dialog-actions overlay-dialog-actions-crop";

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className =
            "overlay-dialog-actions-end px-4 h-9 rounded-lg text-sm font-medium transition cursor-pointer bg-(--btn-regular-bg) hover:bg-(--btn-regular-bg-hover) text-(--btn-content)";
        cancelBtn.textContent = t(I18nKey.interactionCommonCancel);

        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className =
            "px-4 h-9 rounded-lg text-sm font-medium transition cursor-pointer bg-(--primary) text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
        applyBtn.disabled = true;
        applyBtn.textContent = t(I18nKey.interactionCommonApplyCrop);

        footer.appendChild(cancelBtn);
        footer.appendChild(applyBtn);
        card.appendChild(body);
        card.appendChild(footer);

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        // 保存引用
        this.overlay = overlay;
        this.viewport = viewport;
        this.img = img;
        this.emptyHint = emptyHint;
        this.fileInput = fileInput;
        this.zoomInput = zoomInput;
        this.applyBtn = applyBtn;
        this.msgEl = msgEl;

        // 绑定事件
        selectBtn.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => {
            const file = fileInput.files?.[0];
            if (file) this.loadFile(file);
        });
        zoomInput.addEventListener("input", () => {
            const zoom = Number.parseFloat(zoomInput.value);
            const anchorX = this.vpWidth > 0 ? this.vpWidth / 2 : 0;
            const anchorY = this.vpHeight > 0 ? this.vpHeight / 2 : 0;
            this.setScaleFromZoom(zoom, anchorX, anchorY);
        });
        applyBtn.addEventListener("click", () => this.applyCrop());
        cancelBtn.addEventListener("click", () => {
            if (!this.processing) this.close(null);
        });
        overlay.addEventListener("click", (e) => {
            if (!this.processing && e.target === overlay) this.close(null);
        });
        overlay.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !this.processing) this.close(null);
        });

        // 视口拖拽
        viewport.addEventListener("pointerdown", (e: PointerEvent) => {
            if (!this.loaded) return;
            this.pointerId = e.pointerId;
            this.pointerX = e.clientX;
            this.pointerY = e.clientY;
            viewport.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        viewport.addEventListener("pointermove", (e: PointerEvent) => {
            if (!this.loaded || this.pointerId !== e.pointerId) return;
            this.offsetX += e.clientX - this.pointerX;
            this.offsetY += e.clientY - this.pointerY;
            this.pointerX = e.clientX;
            this.pointerY = e.clientY;
            this.renderImage();
            e.preventDefault();
        });
        const releasePointer = (e: PointerEvent): void => {
            if (this.pointerId !== e.pointerId) return;
            if (viewport.hasPointerCapture(e.pointerId)) {
                viewport.releasePointerCapture(e.pointerId);
            }
            this.pointerId = null;
        };
        viewport.addEventListener("pointerup", releasePointer);
        viewport.addEventListener("pointercancel", releasePointer);
    }

    // ── 显示/关闭 ──

    private showOverlay(): void {
        if (!this.overlay) return;
        this.resetState();
        this.overlay.style.display = "";
        document.body.classList.add("overflow-hidden");
        this.overlay.focus();
    }

    private close(result: Blob | null): void {
        if (this.overlay) {
            this.overlay.style.display = "none";
        }
        document.body.classList.remove("overflow-hidden");
        this.resetState();
        if (this.resolve) {
            this.resolve(result);
            this.resolve = null;
        }
    }

    // ── 图片加载 ──

    private loadFile(file: File): void {
        if (!this.img) return;
        if (!file.type.startsWith("image/")) {
            this.setMsg(t(I18nKey.interactionCommonSelectImage));
            return;
        }
        if (file.size > this.config.maxFileSize) {
            const label =
                UPLOAD_LIMIT_LABELS["article-cover"] ??
                `${Math.round(this.config.maxFileSize / 1024 / 1024)} MB`;
            this.setMsg(
                tFmt(I18nKey.interactionCommonImageTooLarge, { size: label }),
            );
            return;
        }
        this.setMsg("");
        const nextUrl = URL.createObjectURL(file);
        const img = this.img;
        img.onload = () => {
            this.loaded = true;
            this.imageWidth = Math.max(1, img.naturalWidth);
            this.imageHeight = Math.max(1, img.naturalHeight);
            this.measureViewport();
            this.minScale = Math.max(
                this.vpWidth / this.imageWidth,
                this.vpHeight / this.imageHeight,
            );
            this.scale = this.minScale;
            this.offsetX = (this.vpWidth - this.imageWidth * this.scale) / 2;
            this.offsetY = (this.vpHeight - this.imageHeight * this.scale) / 2;
            if (this.zoomInput) {
                this.zoomInput.value = String(this.config.zoomMin);
            }
            this.renderImage();
            this.updateApplyState();
        };
        img.onerror = () => {
            this.setMsg(t(I18nKey.interactionCommonImageReadFailed));
            this.resetState();
        };
        this.revokeObjectUrl();
        this.objectUrl = nextUrl;
        img.src = nextUrl;
    }

    // ── 渲染 ──

    private measureViewport(): void {
        if (!this.viewport) {
            this.vpWidth = 0;
            this.vpHeight = 0;
            return;
        }
        const rect = this.viewport.getBoundingClientRect();
        this.vpWidth = Math.max(0, Math.floor(rect.width));
        this.vpHeight = Math.max(0, Math.floor(rect.height));
    }

    private clampOffset(): void {
        if (!this.loaded || this.vpWidth <= 0 || this.vpHeight <= 0) return;
        const scaledW = this.imageWidth * this.scale;
        const scaledH = this.imageHeight * this.scale;
        this.offsetX = clamp(this.offsetX, this.vpWidth - scaledW, 0);
        this.offsetY = clamp(this.offsetY, this.vpHeight - scaledH, 0);
    }

    private renderImage(): void {
        if (!this.img) return;
        if (!this.loaded) {
            this.img.classList.add("hidden");
            if (this.emptyHint) this.emptyHint.classList.remove("hidden");
            return;
        }
        this.clampOffset();
        this.img.classList.remove("hidden");
        this.img.style.width = `${this.imageWidth}px`;
        this.img.style.height = `${this.imageHeight}px`;
        this.img.style.transformOrigin = "top left";
        this.img.style.transform = `translate3d(${this.offsetX}px, ${this.offsetY}px, 0) scale(${this.scale})`;
        if (this.emptyHint) this.emptyHint.classList.add("hidden");
    }

    // ── 缩放 ──

    private setScaleFromZoom(
        zoomPercent: number,
        anchorX: number,
        anchorY: number,
    ): void {
        if (!this.loaded || this.vpWidth <= 0 || this.vpHeight <= 0) return;
        const normalized = clamp(
            Number.isFinite(zoomPercent) ? zoomPercent : this.config.zoomMin,
            this.config.zoomMin,
            this.config.zoomMax,
        );
        const nextScale = this.minScale * (normalized / 100);
        const safeAnchorX = clamp(anchorX, 0, this.vpWidth);
        const safeAnchorY = clamp(anchorY, 0, this.vpHeight);
        const imgPointX = (safeAnchorX - this.offsetX) / this.scale;
        const imgPointY = (safeAnchorY - this.offsetY) / this.scale;
        this.scale = nextScale;
        this.offsetX = safeAnchorX - imgPointX * this.scale;
        this.offsetY = safeAnchorY - imgPointY * this.scale;
        this.clampOffset();
        this.renderImage();
        if (this.zoomInput) {
            this.zoomInput.value = String(Math.round(normalized));
        }
    }

    // ── 裁剪 / 输出 ──

    private async buildBlob(): Promise<Blob | null> {
        if (!this.loaded || !this.img) return null;
        if (this.vpWidth <= 0 || this.vpHeight <= 0) return null;

        const canvas = document.createElement("canvas");
        canvas.width = this.config.outputWidth;
        canvas.height = this.config.outputHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        const ratioX = this.config.outputWidth / this.vpWidth;
        const ratioY = this.config.outputHeight / this.vpHeight;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
            this.img,
            this.offsetX * ratioX,
            this.offsetY * ratioY,
            this.imageWidth * this.scale * ratioX,
            this.imageHeight * this.scale * ratioY,
        );

        return new Promise<Blob | null>((resolve) => {
            canvas.toBlob(
                (blob) => resolve(blob),
                this.config.outputMime,
                this.config.outputQuality,
            );
        });
    }

    private async applyCrop(): Promise<void> {
        if (!this.loaded) {
            this.setMsg(t(I18nKey.interactionCommonSelectImageFirst));
            return;
        }
        this.processing = true;
        this.updateApplyState();
        try {
            const blob = await this.buildBlob();
            if (!blob) {
                this.setMsg(t(I18nKey.interactionCommonCropFailed));
                return;
            }
            this.close(blob);
        } finally {
            this.processing = false;
            this.updateApplyState();
        }
    }

    // ── 状态管理 ──

    private resetState(): void {
        this.revokeObjectUrl();
        this.loaded = false;
        this.imageWidth = 0;
        this.imageHeight = 0;
        this.vpWidth = 0;
        this.vpHeight = 0;
        this.minScale = 1;
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.pointerId = null;
        this.pointerX = 0;
        this.pointerY = 0;
        this.processing = false;
        if (this.img) {
            this.img.removeAttribute("src");
            this.img.classList.add("hidden");
            this.img.style.transform = "";
            this.img.style.width = "";
            this.img.style.height = "";
        }
        if (this.zoomInput) {
            this.zoomInput.value = String(this.config.zoomMin);
        }
        if (this.emptyHint) {
            this.emptyHint.classList.remove("hidden");
        }
        if (this.fileInput) {
            this.fileInput.value = "";
        }
        this.setMsg("");
        this.updateApplyState();
    }

    private revokeObjectUrl(): void {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = "";
        }
    }

    private updateApplyState(): void {
        if (!this.applyBtn) return;
        this.applyBtn.disabled = !this.loaded || this.processing;
        this.applyBtn.textContent = this.processing
            ? t(I18nKey.interactionCommonProcessing)
            : t(I18nKey.interactionCommonApplyCrop);
    }

    private setMsg(msg: string): void {
        if (this.msgEl) this.msgEl.textContent = msg;
    }
}
