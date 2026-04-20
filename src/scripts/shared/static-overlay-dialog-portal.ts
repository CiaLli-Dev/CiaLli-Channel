type OverlayDialogLike = {
    parentElement: unknown;
};

type OverlayDialogQueryRoot = {
    querySelectorAll: (selector: string) => Iterable<OverlayDialogLike>;
};

type OverlayDialogPortalParent = {
    appendChild: (child: OverlayDialogLike) => OverlayDialogLike;
};

const STATIC_OVERLAY_DIALOG_SELECTOR = ".overlay-dialog";

export function relocateStaticOverlayDialogsToBody(
    root: OverlayDialogQueryRoot = document as unknown as OverlayDialogQueryRoot,
): void {
    const body = document.body as unknown as OverlayDialogPortalParent | null;
    if (!body) {
        return;
    }

    const overlayDialogs = Array.from(
        root.querySelectorAll(STATIC_OVERLAY_DIALOG_SELECTOR),
    );

    overlayDialogs.forEach((overlayDialog) => {
        if (overlayDialog.parentElement === body) {
            return;
        }

        // 页面内静态写死的 overlay-dialog 会被过渡容器的 transform/filter 捕获，
        // 导致 fixed 背景只覆盖局部内容列；统一提升到 body 才能稳定覆盖整个视口。
        body.appendChild(overlayDialog);
    });
}
