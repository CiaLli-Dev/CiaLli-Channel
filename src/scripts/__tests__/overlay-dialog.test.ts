import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeEvent = {
    target: FakeElement;
    preventDefault: () => void;
    stopPropagation: () => void;
};

type FakeListener = (event: FakeEvent) => void;

type FakeElement = {
    hidden: boolean;
    textContent: string;
    className: string;
    isConnected: boolean;
    parent: FakeElement | null;
    children: FakeElement[];
    style: Record<string, string>;
    classList: {
        add: (...tokens: string[]) => void;
        remove: (...tokens: string[]) => void;
        toggle: (token: string, force?: boolean) => boolean;
        contains: (token: string) => boolean;
    };
    setAttribute: (name: string, value: string) => void;
    getAttribute: (name: string) => string | null;
    appendChild: (child: FakeElement) => FakeElement;
    replaceChildren: (...children: FakeElement[]) => void;
    addEventListener: (type: string, listener: FakeListener) => void;
    removeEventListener: (type: string, listener: FakeListener) => void;
    dispatch: (type: string, target?: FakeElement) => void;
    focus: () => void;
};

function createFakeElement(): FakeElement {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    const listeners = new Map<string, FakeListener[]>();

    const element: FakeElement = {
        hidden: false,
        textContent: "",
        className: "",
        isConnected: false,
        parent: null,
        children: [],
        style: {},
        classList: {
            add: (...tokens) => {
                tokens.forEach((token) => {
                    const item = token.trim();
                    if (item) {
                        classes.add(item);
                    }
                });
                element.className = Array.from(classes).join(" ");
            },
            remove: (...tokens) => {
                tokens.forEach((token) => {
                    classes.delete(token.trim());
                });
                element.className = Array.from(classes).join(" ");
            },
            toggle: (token, force) => {
                const normalized = token.trim();
                if (!normalized) {
                    return false;
                }
                if (force === true) {
                    classes.add(normalized);
                    element.className = Array.from(classes).join(" ");
                    return true;
                }
                if (force === false) {
                    classes.delete(normalized);
                    element.className = Array.from(classes).join(" ");
                    return false;
                }
                if (classes.has(normalized)) {
                    classes.delete(normalized);
                    element.className = Array.from(classes).join(" ");
                    return false;
                }
                classes.add(normalized);
                element.className = Array.from(classes).join(" ");
                return true;
            },
            contains: (token) => classes.has(token.trim()),
        },
        setAttribute: (name, value) => {
            attributes.set(name, value);
        },
        getAttribute: (name) => attributes.get(name) || null,
        appendChild: (child) => {
            if (child.parent) {
                child.parent.children = child.parent.children.filter(
                    (item) => item !== child,
                );
            }
            child.parent = element;
            element.children.push(child);
            child.isConnected = element.isConnected;
            child.children.forEach((node) => {
                node.isConnected = child.isConnected;
            });
            return child;
        },
        replaceChildren: (...children) => {
            element.children.forEach((child) => {
                child.parent = null;
                child.isConnected = false;
            });
            element.children = [];
            children.forEach((child) => {
                element.appendChild(child);
            });
        },
        addEventListener: (type, listener) => {
            const current = listeners.get(type) || [];
            current.push(listener);
            listeners.set(type, current);
        },
        removeEventListener: (type, listener) => {
            const current = listeners.get(type) || [];
            listeners.set(
                type,
                current.filter((item) => item !== listener),
            );
        },
        dispatch: (type, target = element) => {
            const current = listeners.get(type) || [];
            current.forEach((listener) => {
                listener({
                    target,
                    preventDefault: () => {},
                    stopPropagation: () => {},
                });
            });
        },
        focus: () => {},
    };

    Object.defineProperty(element, "className", {
        get: () => Array.from(classes).join(" "),
        set: (value: string) => {
            classes.clear();
            value
                .split(/\s+/)
                .map((item) => item.trim())
                .filter(Boolean)
                .forEach((item) => {
                    classes.add(item);
                });
        },
    });

    return element;
}

type FakeDocument = {
    body: FakeElement;
    createElement: (tagName: string) => FakeElement;
    addEventListener: (type: string, listener: FakeListener) => void;
    removeEventListener: (type: string, listener: FakeListener) => void;
};

function createFakeDocument(): FakeDocument {
    const body = createFakeElement();
    body.isConnected = true;
    const listeners = new Map<string, FakeListener[]>();

    return {
        body,
        createElement: (_tagName: string) => createFakeElement(),
        addEventListener: (type, listener) => {
            const current = listeners.get(type) || [];
            current.push(listener);
            listeners.set(type, current);
        },
        removeEventListener: (type, listener) => {
            const current = listeners.get(type) || [];
            listeners.set(
                type,
                current.filter((item) => item !== listener),
            );
        },
    };
}

function findDialogTree(fakeDocument: FakeDocument): {
    card: FakeElement;
    body: FakeElement;
    actions: FakeElement;
    customContent: FakeElement;
} {
    const overlay = fakeDocument.body.children[0];
    const card = overlay?.children[0];
    const body = card?.children[0];
    const actions = card?.children[1];
    const customContent = body?.children[2];
    if (!card || !body || !actions || !customContent) {
        throw new Error("overlay dialog tree not found");
    }
    return {
        card,
        body,
        actions,
        customContent,
    };
}

describe("overlay-dialog custom content", () => {
    let fakeDocument: FakeDocument;

    beforeEach(() => {
        vi.resetModules();
        fakeDocument = createFakeDocument();
        vi.stubGlobal("document", fakeDocument as unknown as Document);
        vi.stubGlobal("window", {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis),
            location: {
                assign: vi.fn(),
            },
        } as unknown as Window & typeof globalThis);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("支持挂载自定义内容并在关闭后回收节点", async () => {
        const { showOverlayDialog } =
            await import("@/scripts/shared/overlay-dialog");
        const customNode = fakeDocument.createElement("section");
        customNode.textContent = "users-table";

        const dialogPromise = showOverlayDialog({
            ariaLabel: "用户列表",
            message: "用户列表",
            dismissKey: "close",
            customContent: {
                node: customNode as unknown as HTMLElement,
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

        const dialog = findDialogTree(fakeDocument);
        expect(dialog.card.classList.contains("card-wide")).toBe(true);
        expect(dialog.body.classList.contains("body-wide")).toBe(true);
        expect(dialog.actions.classList.contains("actions-end")).toBe(true);
        expect(dialog.customContent.hidden).toBe(false);
        expect(dialog.customContent.children[0]).toBe(customNode);
        expect(
            dialog.customContent.classList.contains("custom-table-wrapper"),
        ).toBe(true);

        const closeButton = dialog.actions.children[0];
        closeButton.dispatch("click", closeButton);
        const result = await dialogPromise;
        expect(result.actionKey).toBe("close");
        expect(dialog.customContent.children).toHaveLength(0);
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
        let dialog = findDialogTree(fakeDocument);
        expect(dialog.card.classList.contains("card-wide")).toBe(true);
        dialog.actions.children[0]?.dispatch("click");
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
        dialog = findDialogTree(fakeDocument);
        expect(dialog.card.classList.contains("card-wide")).toBe(false);
        dialog.actions.children[0]?.dispatch("click");
        await secondDialogPromise;
    });
});
