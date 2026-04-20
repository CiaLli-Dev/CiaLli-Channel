import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeElement = {
    className: string;
    parentElement: FakeElement | null;
    children: FakeElement[];
    appendChild: (child: FakeElement) => FakeElement;
    querySelectorAll: (selector: string) => FakeElement[];
};

type FakeDocument = {
    body: FakeElement;
    querySelectorAll: (selector: string) => FakeElement[];
};

function createFakeElement(className = ""): FakeElement {
    const element: FakeElement = {
        className,
        parentElement: null,
        children: [],
        appendChild: (child) => {
            if (child.parentElement) {
                child.parentElement.children =
                    child.parentElement.children.filter(
                        (entry) => entry !== child,
                    );
            }
            child.parentElement = element;
            element.children.push(child);
            return child;
        },
        querySelectorAll: (selector) => collectMatches(element, selector),
    };

    return element;
}

function collectMatches(root: FakeElement, selector: string): FakeElement[] {
    if (selector !== ".overlay-dialog") {
        return [];
    }

    const matches: FakeElement[] = [];
    const queue = [...root.children];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }

        if (
            current.className
                .split(/\s+/)
                .map((token) => token.trim())
                .filter(Boolean)
                .includes("overlay-dialog")
        ) {
            matches.push(current);
        }

        queue.push(...current.children);
    }

    return matches;
}

function createFakeDocument(): FakeDocument {
    const body = createFakeElement("body");
    return {
        body,
        querySelectorAll: (selector) => body.querySelectorAll(selector),
    };
}

describe("static-overlay-dialog-portal", () => {
    let fakeDocument: FakeDocument;

    beforeEach(() => {
        vi.resetModules();
        fakeDocument = createFakeDocument();
        vi.stubGlobal("document", fakeDocument as unknown as Document);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("会将静态 overlay-dialog 提升到 body 末尾", async () => {
        const { relocateStaticOverlayDialogsToBody } =
            await import("@/scripts/shared/static-overlay-dialog-portal");
        const wrapper = createFakeElement("content-wrapper");
        const overlay = createFakeElement("overlay-dialog hidden px-4");
        const sibling = createFakeElement("regular-block");

        fakeDocument.body.appendChild(wrapper);
        fakeDocument.body.appendChild(sibling);
        wrapper.appendChild(overlay);

        relocateStaticOverlayDialogsToBody();

        expect(overlay.parentElement).toBe(fakeDocument.body);
        expect(wrapper.children).toHaveLength(0);
        expect(fakeDocument.body.children.at(-1)).toBe(overlay);
    });

    it("只会处理指定根节点范围内的 overlay-dialog", async () => {
        const { relocateStaticOverlayDialogsToBody } =
            await import("@/scripts/shared/static-overlay-dialog-portal");
        const wrapperA = createFakeElement("wrapper-a");
        const wrapperB = createFakeElement("wrapper-b");
        const overlayA = createFakeElement("overlay-dialog hidden");
        const overlayB = createFakeElement("overlay-dialog hidden");

        fakeDocument.body.appendChild(wrapperA);
        fakeDocument.body.appendChild(wrapperB);
        wrapperA.appendChild(overlayA);
        wrapperB.appendChild(overlayB);

        relocateStaticOverlayDialogsToBody(wrapperA);

        expect(overlayA.parentElement).toBe(fakeDocument.body);
        expect(overlayB.parentElement).toBe(wrapperB);
    });

    it("已经在 body 下的 overlay-dialog 不会重复搬运", async () => {
        const { relocateStaticOverlayDialogsToBody } =
            await import("@/scripts/shared/static-overlay-dialog-portal");
        const overlay = createFakeElement("overlay-dialog hidden");

        fakeDocument.body.appendChild(overlay);

        relocateStaticOverlayDialogsToBody();

        expect(fakeDocument.body.children).toEqual([overlay]);
        expect(overlay.parentElement).toBe(fakeDocument.body);
    });
});
