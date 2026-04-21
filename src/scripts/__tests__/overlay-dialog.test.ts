import { beforeEach, describe, expect, it, vi } from "vitest";

function getDialogParts() {
    const overlay = document.querySelector<HTMLElement>(".overlay-dialog");
    const card = overlay?.querySelector<HTMLElement>(".overlay-dialog-card");
    const body = overlay?.querySelector<HTMLElement>(".overlay-dialog-body");
    const actions = overlay?.querySelector<HTMLElement>(
        ".overlay-dialog-actions",
    );
    const customContent = overlay?.querySelector<HTMLElement>(
        ".overlay-dialog-custom-content",
    );

    if (!overlay || !card || !body || !actions || !customContent) {
        throw new Error("overlay dialog tree not found");
    }

    return {
        overlay,
        card,
        body,
        actions,
        customContent,
    };
}

describe("overlay-dialog custom content", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it("支持挂载自定义内容并在关闭后回收节点", async () => {
        const { showOverlayDialog } =
            await import("@/scripts/shared/overlay-dialog");
        const customNode = document.createElement("section");
        customNode.textContent = "users-table";

        const dialogPromise = showOverlayDialog({
            ariaLabel: "用户列表",
            message: "用户列表",
            dismissKey: "close",
            customContent: {
                node: customNode,
                className: "custom-table-wrapper",
            },
            cardClassName: "card-wide",
            bodyClassName: "body-wide",
            actionsClassName: "actions-end",
            actions: [
                {
                    key: "close",
                    label: "关闭",
                    variant: "secondary",
                },
            ],
        });

        const dialog = getDialogParts();
        expect(dialog.card.classList.contains("card-wide")).toBe(true);
        expect(dialog.body.classList.contains("body-wide")).toBe(true);
        expect(dialog.actions.classList.contains("actions-end")).toBe(true);
        expect(dialog.customContent.hidden).toBe(false);
        expect(
            dialog.customContent.classList.contains("custom-table-wrapper"),
        ).toBe(true);
        expect(dialog.customContent.firstElementChild).toBe(customNode);

        dialog.actions
            .querySelector("button")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        const result = await dialogPromise;
        expect(result.actionKey).toBe("close");
        expect(dialog.customContent.childElementCount).toBe(0);
        expect(dialog.customContent.hidden).toBe(true);
    });

    it("二次打开时不会残留上一次的扩展样式", async () => {
        const { showOverlayDialog } =
            await import("@/scripts/shared/overlay-dialog");

        const firstDialogPromise = showOverlayDialog({
            ariaLabel: "第一次",
            message: "第一次",
            dismissKey: "close",
            cardClassName: "card-wide",
            actions: [
                {
                    key: "close",
                    label: "关闭",
                    variant: "secondary",
                },
            ],
        });

        let dialog = getDialogParts();
        expect(dialog.card.classList.contains("card-wide")).toBe(true);
        dialog.actions
            .querySelector("button")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await firstDialogPromise;

        const secondDialogPromise = showOverlayDialog({
            ariaLabel: "第二次",
            message: "第二次",
            dismissKey: "close",
            actions: [
                {
                    key: "close",
                    label: "关闭",
                    variant: "secondary",
                },
            ],
        });

        dialog = getDialogParts();
        expect(dialog.card.classList.contains("card-wide")).toBe(false);
        dialog.actions
            .querySelector("button")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await secondDialogPromise;
    });
});
