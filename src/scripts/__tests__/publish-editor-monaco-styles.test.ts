import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    ensurePublishMonacoStylesheet,
    restoreDetachedMonacoThemeServiceStyles,
} from "../publish-editor-monaco-styles";

type MockCssRule = {
    cssText?: string;
    cssRules?: MockCssRule[];
    styleSheet?: {
        cssRules?: MockCssRule[];
    } | null;
};

class MockLinkElement extends EventTarget {
    rel = "";
    href = "";
    sheet: Record<string, never> | null = null;

    private readonly attributes = new Map<string, string>();

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }
}

class MockHeadElement {
    readonly children: MockLinkElement[] = [];
    monacoColorStyle: MockStyleElement | null = null;

    appendChild(child: MockLinkElement): MockLinkElement {
        this.children.push(child);
        return child;
    }

    querySelector(selector: string): MockStyleElement | null {
        if (selector === "style.monaco-colors") {
            return this.monacoColorStyle;
        }
        return null;
    }
}

class MockStyleElement {
    className = "monaco-colors";
    textContent = "";
    isConnected = true;

    constructor(public ownerDocument: Document) {}
}

class MockDocument {
    readonly head = new MockHeadElement();

    constructor(
        public readonly styleSheets: ArrayLike<{ cssRules?: MockCssRule[] }>,
    ) {}

    createElement(tagName: string): MockLinkElement {
        if (tagName !== "link") {
            throw new Error(`Unsupported tag: ${tagName}`);
        }
        return new MockLinkElement();
    }

    querySelector(selector: string): MockLinkElement | null {
        if (!selector.includes("data-publish-monaco-stylesheet")) {
            return null;
        }

        return (
            this.head.children.find(
                (child) =>
                    child.getAttribute("data-publish-monaco-stylesheet") ===
                    "1",
            ) ?? null
        );
    }
}

function createDocumentWithMonacoStyles(): MockDocument {
    return new MockDocument([
        {
            cssRules: [{ cssText: ".monaco-editor { position: relative; }" }],
        },
    ]);
}

function createDocumentWithoutMonacoStyles(): MockDocument {
    return new MockDocument([]);
}

describe("ensurePublishMonacoStylesheet", () => {
    beforeEach(() => {
        vi.stubGlobal("HTMLLinkElement", MockLinkElement);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("当前文档已有 Monaco 样式时不会重复挂载 fallback 链接", async () => {
        const documentStub = createDocumentWithMonacoStyles();

        await ensurePublishMonacoStylesheet(
            documentStub as unknown as Document,
        );

        expect(documentStub.head.children).toHaveLength(0);
    });

    it("当前文档缺少 Monaco 样式时会补挂 fallback 链接", async () => {
        const documentStub = createDocumentWithoutMonacoStyles();

        const pending = ensurePublishMonacoStylesheet(
            documentStub as unknown as Document,
        );

        expect(documentStub.head.children).toHaveLength(1);
        const fallbackLink = documentStub.head.children[0];
        expect(fallbackLink.rel).toBe("stylesheet");
        expect(
            fallbackLink.getAttribute("data-publish-monaco-stylesheet"),
        ).toBe("1");

        fallbackLink.sheet = {};
        fallbackLink.dispatchEvent(new Event("load"));
        await pending;

        expect(
            fallbackLink.getAttribute("data-publish-monaco-stylesheet-loaded"),
        ).toBe("true");
    });

    it("文档被替换后会为新文档重新挂载 fallback 链接", async () => {
        const firstDocument = createDocumentWithoutMonacoStyles();
        const firstPending = ensurePublishMonacoStylesheet(
            firstDocument as unknown as Document,
        );
        const firstLink = firstDocument.head.children[0];
        firstLink.sheet = {};
        firstLink.dispatchEvent(new Event("load"));
        await firstPending;

        const secondDocument = createDocumentWithoutMonacoStyles();
        const secondPending = ensurePublishMonacoStylesheet(
            secondDocument as unknown as Document,
        );

        expect(secondDocument.head.children).toHaveLength(1);
        expect(secondDocument.head.children[0]).not.toBe(firstLink);

        secondDocument.head.children[0].sheet = {};
        secondDocument.head.children[0].dispatchEvent(new Event("load"));
        await secondPending;
    });

    it("theme service 指向旧文档样式时会重新绑定到当前文档", () => {
        const firstDocument = createDocumentWithoutMonacoStyles();
        const secondDocument = createDocumentWithoutMonacoStyles();
        const secondStyleElement = new MockStyleElement(
            secondDocument as unknown as Document,
        );
        secondDocument.head.monacoColorStyle = secondStyleElement;

        const staleStyleElement = new MockStyleElement(
            firstDocument as unknown as Document,
        );
        staleStyleElement.isConnected = false;

        const registerEditorContainer = vi.fn();
        const themeService = {
            _allCSS: ".monaco-editor { color: red; }",
            _globalStyleElement: staleStyleElement,
            _styleElements: [staleStyleElement],
            registerEditorContainer,
        };

        restoreDetachedMonacoThemeServiceStyles(
            themeService,
            {} as HTMLElement,
            secondDocument as unknown as Document,
        );

        expect(themeService._globalStyleElement).toBe(secondStyleElement);
        expect(themeService._styleElements).toContain(secondStyleElement);
        expect(secondStyleElement.textContent).toBe(themeService._allCSS);
        expect(registerEditorContainer).not.toHaveBeenCalled();
    });

    it("当前文档没有 monaco-colors 时会让 theme service 重新创建", () => {
        const firstDocument = createDocumentWithoutMonacoStyles();
        const secondDocument = createDocumentWithoutMonacoStyles();
        const staleStyleElement = new MockStyleElement(
            firstDocument as unknown as Document,
        );
        staleStyleElement.isConnected = false;

        const registerEditorContainer = vi.fn(() => ({
            dispose: () => {
                // 测试无需额外清理。
            },
        }));
        const themeService = {
            _allCSS: ".monaco-editor { color: red; }",
            _globalStyleElement: staleStyleElement,
            _styleElements: [staleStyleElement],
            registerEditorContainer,
        };

        restoreDetachedMonacoThemeServiceStyles(
            themeService,
            {} as HTMLElement,
            secondDocument as unknown as Document,
        );

        expect(themeService._globalStyleElement).toBeNull();
        expect(registerEditorContainer).toHaveBeenCalledTimes(1);
    });
});
