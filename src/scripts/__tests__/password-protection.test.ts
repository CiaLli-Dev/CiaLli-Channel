import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { bindPasswordProtectionOwnerSyncMock } = vi.hoisted(() => ({
    bindPasswordProtectionOwnerSyncMock: vi.fn(),
}));

vi.mock("@/scripts/password-protection-owner", () => ({
    bindPasswordProtectionOwnerSync: bindPasswordProtectionOwnerSyncMock,
}));

type Listener = (event?: { key?: string }) => void;

type FakeListenerOptions = {
    once?: boolean;
};

class FakeEventTarget {
    private readonly listeners = new Map<
        string,
        Array<{
            listener: Listener;
            options?: FakeListenerOptions;
        }>
    >();

    addEventListener(
        type: string,
        listener: Listener,
        options?: FakeListenerOptions,
    ): void {
        const current = this.listeners.get(type) || [];
        current.push({ listener, options });
        this.listeners.set(type, current);
    }

    removeEventListener(type: string, listener: Listener): void {
        const current = this.listeners.get(type) || [];
        this.listeners.set(
            type,
            current.filter((item) => item.listener !== listener),
        );
    }

    dispatch(type: string, event?: { key?: string }): void {
        const current = [...(this.listeners.get(type) || [])];
        current.forEach((item) => {
            item.listener(event);
            if (item.options?.once) {
                this.removeEventListener(type, item.listener);
            }
        });
    }
}

class FakeElement extends FakeEventTarget {
    id = "";
    dataset: Record<string, string> = {};
    style: Record<string, string> = {};
    textContent = "";
    value = "";
    disabled = false;
    isConnected = true;

    readonly classList = {
        add: (...tokens: string[]) => {
            tokens.forEach((token) => {
                this.classes.add(token);
            });
        },
        remove: (...tokens: string[]) => {
            tokens.forEach((token) => {
                this.classes.delete(token);
            });
        },
        contains: (token: string) => this.classes.has(token),
    };

    private readonly classes = new Set<string>();
    private readonly attributes = new Map<string, string>();
    private readonly selectorMap = new Map<string, FakeElement | null>();

    focus(): void {}

    remove(): void {
        this.isConnected = false;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    hasAttribute(name: string): boolean {
        return this.attributes.has(name);
    }

    setQueryResult(selector: string, element: FakeElement | null): void {
        this.selectorMap.set(selector, element);
    }

    querySelector<T extends FakeElement>(selector: string): T | null {
        return (this.selectorMap.get(selector) as T | null) ?? null;
    }
}

class FakeHTMLElement extends FakeElement {}

class FakeHTMLInputElement extends FakeHTMLElement {}

class FakeHTMLButtonElement extends FakeHTMLElement {}

class FakeDocument extends FakeEventTarget {
    readyState: "loading" | "complete" = "complete";

    constructor(private readonly elements: Record<string, FakeElement>) {
        super();
    }

    getElementById(id: string): FakeElement | null {
        return this.elements[id] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        if (selector === "#share-component, .detail-share-btn") {
            return [];
        }
        return [];
    }
}

class FakeWindow extends FakeEventTarget {
    location = {
        pathname: "/posts/encrypted",
    };

    setTimeout = globalThis.setTimeout.bind(globalThis);
    clearTimeout = globalThis.clearTimeout.bind(globalThis);
}

type PasswordProtectionTestWindow = FakeWindow &
    Window &
    typeof globalThis & {
        __ppDecryptPayloadV2?: (
            input: unknown,
            password: string,
        ) => Promise<string>;
        __ppSanitizeDecryptedHtml?: (rawHtml: unknown) => string;
        __ppResolveProtectedHtml?: (rawContent: unknown) => string;
        __ppDispatchPostDecryptTasks?: (
            contentBodyDiv: HTMLElement,
        ) => Promise<void>;
    };

function createFakeSessionStorage(): Storage {
    const store = new Map<string, string>();
    return {
        length: 0,
        clear: () => {
            store.clear();
        },
        getItem: (key) => store.get(key) ?? null,
        key: (index) => Array.from(store.keys())[index] ?? null,
        removeItem: (key) => {
            store.delete(key);
        },
        setItem: (key, value) => {
            store.set(key, value);
        },
    };
}

function createPasswordProtectionDom(): {
    protectionDiv: FakeHTMLElement;
    passwordInput: FakeHTMLInputElement;
    unlockBtn: FakeHTMLButtonElement;
    errorMessage: FakeHTMLElement;
    contentDiv: FakeHTMLElement;
    contentBodyDiv: FakeHTMLElement;
} {
    const protectionDiv = new FakeHTMLElement();
    const passwordInput = new FakeHTMLInputElement();
    const unlockBtn = new FakeHTMLButtonElement();
    const errorMessage = new FakeHTMLElement();
    const contentDiv = new FakeHTMLElement();
    const contentBodyDiv = new FakeHTMLElement();
    const inputGroup = new FakeHTMLElement();
    const hint = new FakeHTMLElement();
    hint.textContent = "hint";

    protectionDiv.id = "password-protection";
    protectionDiv.dataset = {
        encryptedContent: "encrypted-payload",
        ownerUserId: "author-1",
        ownerPasswordStorageKeys: "[]",
        i18nUnlocking: "Unlocking...",
        i18nIncorrect: "Incorrect password.",
        i18nUnlock: "Unlock",
        i18nPasswordRequired: "Password is required.",
        i18nDecryptionError: "Decryption failed.",
        i18nPasswordDecryptRetry: "Retry unlock.",
    };
    passwordInput.id = "password-input";
    unlockBtn.id = "unlock-btn";
    errorMessage.id = "error-message";
    contentDiv.id = "decrypted-content";
    contentBodyDiv.id = "decrypted-content-body";

    protectionDiv.setQueryResult(".password-input-group", inputGroup);
    protectionDiv.setQueryResult(".password-container p", hint);

    return {
        protectionDiv,
        passwordInput,
        unlockBtn,
        errorMessage,
        contentDiv,
        contentBodyDiv,
    };
}

describe("password-protection", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        bindPasswordProtectionOwnerSyncMock.mockReturnValue(vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("未解锁离开页面时会解除 owner-state 订阅且只清理一次", async () => {
        const stopOwnerSync = vi.fn();
        bindPasswordProtectionOwnerSyncMock.mockReturnValue(stopOwnerSync);
        const dom = createPasswordProtectionDom();
        const fakeDocument = new FakeDocument({
            "password-protection": dom.protectionDiv,
            "password-input": dom.passwordInput,
            "unlock-btn": dom.unlockBtn,
            "error-message": dom.errorMessage,
            "decrypted-content": dom.contentDiv,
            "decrypted-content-body": dom.contentBodyDiv,
        });
        const fakeWindow = new FakeWindow();

        vi.stubGlobal("document", fakeDocument as unknown as Document);
        vi.stubGlobal(
            "window",
            fakeWindow as unknown as Window & typeof globalThis,
        );
        vi.stubGlobal("sessionStorage", createFakeSessionStorage());
        vi.stubGlobal("HTMLElement", FakeHTMLElement);
        vi.stubGlobal("HTMLInputElement", FakeHTMLInputElement);
        vi.stubGlobal("HTMLButtonElement", FakeHTMLButtonElement);

        await import("@/scripts/password-protection");

        expect(bindPasswordProtectionOwnerSyncMock).toHaveBeenCalledTimes(1);
        expect(stopOwnerSync).not.toHaveBeenCalled();

        fakeDocument.dispatch("astro:before-swap");
        fakeWindow.dispatch("pagehide");

        expect(stopOwnerSync).toHaveBeenCalledTimes(1);

        fakeDocument.dispatch("astro:before-swap");
        fakeWindow.dispatch("pagehide");

        expect(stopOwnerSync).toHaveBeenCalledTimes(1);
    });

    it("解锁成功后仍会回收 owner-state 订阅", async () => {
        const stopOwnerSync = vi.fn();
        bindPasswordProtectionOwnerSyncMock.mockReturnValue(stopOwnerSync);
        const dom = createPasswordProtectionDom();
        const fakeDocument = new FakeDocument({
            "password-protection": dom.protectionDiv,
            "password-input": dom.passwordInput,
            "unlock-btn": dom.unlockBtn,
            "error-message": dom.errorMessage,
            "decrypted-content": dom.contentDiv,
            "decrypted-content-body": dom.contentBodyDiv,
        });
        const fakeWindow = new FakeWindow() as PasswordProtectionTestWindow;
        fakeWindow.__ppDecryptPayloadV2 = vi
            .fn()
            .mockResolvedValue("<p>decrypted</p>");
        fakeWindow.__ppSanitizeDecryptedHtml = vi.fn((rawHtml: unknown) =>
            String(rawHtml),
        );
        fakeWindow.__ppResolveProtectedHtml = vi.fn((rawContent: unknown) =>
            String(rawContent),
        );
        fakeWindow.__ppDispatchPostDecryptTasks = vi
            .fn()
            .mockResolvedValue(undefined);

        vi.stubGlobal("document", fakeDocument as unknown as Document);
        vi.stubGlobal(
            "window",
            fakeWindow as unknown as Window & typeof globalThis,
        );
        vi.stubGlobal("sessionStorage", createFakeSessionStorage());
        vi.stubGlobal("HTMLElement", FakeHTMLElement);
        vi.stubGlobal("HTMLInputElement", FakeHTMLInputElement);
        vi.stubGlobal("HTMLButtonElement", FakeHTMLButtonElement);

        await import("@/scripts/password-protection");

        dom.passwordInput.value = "secret";
        dom.unlockBtn.dispatch("click");
        await Promise.resolve();

        expect(stopOwnerSync).toHaveBeenCalledTimes(1);
        expect(dom.protectionDiv.isConnected).toBe(false);
    });
});
