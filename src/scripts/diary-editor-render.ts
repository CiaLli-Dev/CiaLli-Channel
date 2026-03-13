import I18nKey from "@/i18n/i18nKey";
import { showConfirmDialog } from "@/scripts/dialogs";
import { t, tFmt } from "@/scripts/i18n-runtime";
import type {
    DiaryImageOrderItem,
    PendingDiaryUpload,
} from "@/scripts/diary-editor-helpers";

export type RenderImageOrderContext = {
    imageOrderListEl: HTMLElement;
    imageOrderEmptyEl: HTMLElement;
    getImageOrderItems: () => DiaryImageOrderItem[];
    setImageOrderItems: (items: DiaryImageOrderItem[]) => void;
    getDragIndex: () => number | null;
    setDragIndex: (index: number | null) => void;
    isSaving: () => boolean;
    pendingUploads: Map<string, PendingDiaryUpload>;
    deletedExistingImageIds: Set<string>;
    setUploadMessage: (message: string, isError?: boolean) => void;
    setSubmitMessage: (message: string) => void;
    renderImageOrder: () => void;
};

export function buildFigureImageContent(
    item: DiaryImageOrderItem,
    index: number,
    totalCount: number,
): HTMLElement {
    const previewHref = item.previewUrl ?? item.localUrl ?? "";
    const thumbSrc = item.thumbUrl ?? item.previewUrl ?? item.localUrl ?? "";

    if (previewHref && thumbSrc) {
        const anchor = document.createElement("a");
        anchor.href = previewHref;
        anchor.className = "block w-full h-full";
        anchor.setAttribute("data-fancybox", "diary-photo-preview");
        if (item.caption) {
            anchor.setAttribute("data-caption", item.caption);
        }

        const image = document.createElement("img");
        image.src = thumbSrc;
        image.alt = item.caption || item.label || "diary image";
        image.loading = "lazy";
        image.className =
            totalCount === 1
                ? "w-full h-auto object-cover"
                : "w-full h-full object-cover";

        anchor.appendChild(image);
        return anchor;
    }

    const fallback = document.createElement("div");
    fallback.className =
        "w-full h-full min-h-24 flex items-center justify-center text-xs text-60";
    fallback.textContent =
        item.label || tFmt(I18nKey.diaryEditorImageLabel, { index: index + 1 });
    return fallback;
}

function buildDeleteButton(
    item: DiaryImageOrderItem,
    ctx: RenderImageOrderContext,
): HTMLButtonElement {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className =
        "w-8 h-8 rounded-full bg-red-500/90 text-white flex items-center justify-center hover:bg-red-500 transition cursor-pointer";
    deleteButton.title = t(I18nKey.diaryEditorDeleteImageTitle);
    deleteButton.setAttribute(
        "aria-label",
        t(I18nKey.diaryEditorDeleteImageTitle),
    );
    deleteButton.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
    deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void removeImageOrderItem(item, ctx);
    });
    return deleteButton;
}

export function buildFigureElement(
    item: DiaryImageOrderItem,
    index: number,
    ctx: RenderImageOrderContext,
): HTMLElement {
    const items = ctx.getImageOrderItems();
    const figure = document.createElement("figure");
    figure.className =
        items.length === 1
            ? "relative overflow-hidden rounded-xl border border-(--line-divider) bg-(--card-bg) group"
            : "relative aspect-square overflow-hidden rounded-xl border border-(--line-divider) bg-(--card-bg) group";
    figure.setAttribute("draggable", "true");

    figure.addEventListener("dragstart", () => {
        ctx.setDragIndex(index);
    });
    figure.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragIndex = ctx.getDragIndex();
        if (dragIndex === null || dragIndex === index) {
            return;
        }
        const dragged = ctx.getImageOrderItems()[dragIndex];
        const next = ctx.getImageOrderItems().filter((_, i) => i !== dragIndex);
        next.splice(index, 0, dragged);
        ctx.setImageOrderItems(next);
        ctx.setDragIndex(index);
        ctx.renderImageOrder();
    });
    figure.addEventListener("dragend", () => {
        ctx.setDragIndex(null);
        ctx.setSubmitMessage(t(I18nKey.diaryEditorImageSortPendingSave));
    });

    const imageContent = buildFigureImageContent(item, index, items.length);
    figure.appendChild(imageContent);

    const orderBadge = document.createElement("div");
    orderBadge.className =
        "absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs";
    orderBadge.textContent = String(index + 1);

    const handle = document.createElement("div");
    handle.className =
        "absolute top-2 left-2 w-6 h-6 rounded bg-black/50 text-white flex items-center justify-center cursor-grab opacity-0 group-hover:opacity-100 transition-opacity";
    handle.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" /></svg>';

    const overlay = document.createElement("div");
    overlay.className =
        "absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100";

    overlay.appendChild(buildDeleteButton(item, ctx));
    figure.append(orderBadge, handle, overlay);
    return figure;
}

export function renderImageOrderImpl(ctx: RenderImageOrderContext): void {
    const items = ctx.getImageOrderItems();
    ctx.imageOrderListEl.innerHTML = "";
    ctx.imageOrderEmptyEl.classList.toggle("hidden", items.length > 0);

    if (items.length === 0) {
        return;
    }

    const fragment = document.createDocumentFragment();
    const gallery = document.createElement("div");
    gallery.className =
        items.length === 1
            ? "w-full"
            : `grid gap-3 ${items.length === 4 ? "grid-cols-2" : "grid-cols-3"}`;

    items.forEach((item, index) => {
        gallery.appendChild(buildFigureElement(item, index, ctx));
    });

    fragment.appendChild(gallery);
    ctx.imageOrderListEl.appendChild(fragment);
}

async function removePendingImageItem(
    item: DiaryImageOrderItem,
    ctx: RenderImageOrderContext,
): Promise<void> {
    if (!item.localUrl) {
        return;
    }
    const pending = ctx.pendingUploads.get(item.localUrl);
    if (pending) {
        URL.revokeObjectURL(pending.localUrl);
        ctx.pendingUploads.delete(item.localUrl);
    }
    ctx.setImageOrderItems(
        ctx.getImageOrderItems().filter((current) => current.key !== item.key),
    );
    ctx.renderImageOrder();
    ctx.setUploadMessage(t(I18nKey.diaryEditorPendingImageRemoved));
}

function removeExistingImageItem(
    item: DiaryImageOrderItem,
    ctx: RenderImageOrderContext,
): void {
    if (!item.imageId) {
        return;
    }
    try {
        ctx.deletedExistingImageIds.add(item.imageId);
        ctx.setImageOrderItems(
            ctx
                .getImageOrderItems()
                .filter((current) => current.key !== item.key),
        );
        ctx.renderImageOrder();
        ctx.setUploadMessage(t(I18nKey.diaryEditorImageRemovedPendingSave));
        ctx.setSubmitMessage(t(I18nKey.diaryEditorImageAdjustmentsPendingSave));
    } catch (error) {
        console.error("[diary-editor] delete image failed:", error);
        ctx.setUploadMessage(t(I18nKey.diaryEditorDeleteImageFailed), true);
    }
}

export async function removeImageOrderItem(
    item: DiaryImageOrderItem,
    ctx: RenderImageOrderContext,
): Promise<void> {
    if (ctx.isSaving()) {
        return;
    }
    const confirmed = await showConfirmDialog({
        message: t(I18nKey.diaryEditorDeleteImageConfirm),
        confirmText: t(I18nKey.interactionCommonDelete),
        confirmVariant: "danger",
    });
    if (!confirmed) {
        return;
    }

    if (item.kind === "pending") {
        await removePendingImageItem(item, ctx);
        return;
    }

    if (item.kind === "existing") {
        removeExistingImageItem(item, ctx);
    }
}
