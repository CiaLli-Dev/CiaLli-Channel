import { bindPasswordProtectionOwnerSync } from "@/scripts/password-protection-owner";

type PasswordProtectionElements = {
    protectionDiv: HTMLElement;
    passwordInput: HTMLInputElement;
    unlockBtn: HTMLButtonElement;
    errorMessage: HTMLElement;
    contentDiv: HTMLElement;
    contentBodyDiv: HTMLElement;
};

type PasswordProtectionConfig = {
    encryptedContent: string;
    ownerUserId: string;
    ownerPasswordStorageKeys: string[];
    i18nUnlocking: string;
    i18nIncorrect: string;
    i18nUnlock: string;
    i18nPasswordRequired: string;
    i18nDecryptionError: string;
    i18nPasswordDecryptRetry: string;
};

function requireProtectionHelpers(): {
    decryptPayloadV2: NonNullable<typeof window.__ppDecryptPayloadV2>;
    sanitizeDecryptedHtml: NonNullable<typeof window.__ppSanitizeDecryptedHtml>;
    resolveProtectedHtml: NonNullable<typeof window.__ppResolveProtectedHtml>;
    dispatchPostDecryptTasks: NonNullable<
        typeof window.__ppDispatchPostDecryptTasks
    >;
} {
    if (
        !window.__ppDecryptPayloadV2 ||
        !window.__ppSanitizeDecryptedHtml ||
        !window.__ppResolveProtectedHtml ||
        !window.__ppDispatchPostDecryptTasks
    ) {
        throw new Error("PASSWORD_PROTECTION_HELPERS_MISSING");
    }
    return {
        decryptPayloadV2: window.__ppDecryptPayloadV2,
        sanitizeDecryptedHtml: window.__ppSanitizeDecryptedHtml,
        resolveProtectedHtml: window.__ppResolveProtectedHtml,
        dispatchPostDecryptTasks: window.__ppDispatchPostDecryptTasks,
    };
}

function normalizeOwnerStorageKeys(rawKeys: string): string[] {
    try {
        const parsed = JSON.parse(rawKeys) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map((key) => String(key || "").trim())
            .filter((key) => Boolean(key));
    } catch {
        return [];
    }
}

function isPasswordInvalidError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "OperationError") {
        return true;
    }
    if (!(error instanceof Error)) {
        return false;
    }
    return error.message === "PASSWORD_INVALID";
}

function readOwnerStoredPassword(
    keys: string[],
    isViewerOwner: boolean,
): string {
    if (!isViewerOwner || keys.length === 0) {
        return "";
    }
    try {
        for (const key of keys) {
            const normalized = String(sessionStorage.getItem(key) || "").trim();
            if (normalized) {
                return normalized;
            }
        }
    } catch (error) {
        console.warn(
            "[password-protection] read owner password failed:",
            error,
        );
    }
    return "";
}

function persistOwnerStoredPassword(
    keys: string[],
    password: string,
    isViewerOwner: boolean,
): void {
    if (!isViewerOwner || keys.length === 0) {
        return;
    }
    const normalized = String(password || "").trim();
    if (!normalized) {
        return;
    }
    try {
        for (const key of keys) {
            sessionStorage.setItem(key, normalized);
        }
    } catch (error) {
        console.warn(
            "[password-protection] persist owner password failed:",
            error,
        );
    }
}

function clearOwnerStoredPassword(
    keys: string[],
    isViewerOwner: boolean,
): void {
    if (!isViewerOwner || keys.length === 0) {
        return;
    }
    try {
        for (const key of keys) {
            sessionStorage.removeItem(key);
        }
    } catch (error) {
        console.warn(
            "[password-protection] clear owner password failed:",
            error,
        );
    }
}

function resolveStoredPassword(
    ownerStorageKeys: string[],
    isViewerOwner: boolean,
): string {
    const pathPassword = String(
        sessionStorage.getItem(`page-password-${window.location.pathname}`) ||
            "",
    ).trim();
    const ownerPassword = readOwnerStoredPassword(
        ownerStorageKeys,
        isViewerOwner,
    );
    return isViewerOwner
        ? ownerPassword || pathPassword
        : pathPassword || ownerPassword;
}

function applyAutoUnlockingState(
    protectionDiv: HTMLElement,
    savedPassword: string,
    i18nUnlocking: string,
): void {
    if (!savedPassword) {
        return;
    }
    const inputGroup = protectionDiv.querySelector<HTMLElement>(
        ".password-input-group",
    );
    if (inputGroup) {
        inputGroup.style.visibility = "hidden";
    }
    const hint = protectionDiv.querySelector<HTMLElement>(
        ".password-container p",
    );
    if (hint) {
        hint.setAttribute("data-original-text", hint.textContent || "");
        hint.textContent = i18nUnlocking;
    }
    protectionDiv.classList.add("auto-unlocking");
}

function rollbackAutoUnlockState(input: {
    protectionDiv: HTMLElement;
    attemptedPassword: string;
    ownerStorageKeys: string[];
    isViewerOwner: boolean;
    passwordInput: HTMLInputElement;
}): void {
    if (!input.attemptedPassword) {
        return;
    }
    sessionStorage.removeItem(`page-password-${window.location.pathname}`);
    clearOwnerStoredPassword(input.ownerStorageKeys, input.isViewerOwner);
    const inputGroup = input.protectionDiv.querySelector<HTMLElement>(
        ".password-input-group",
    );
    if (inputGroup) {
        inputGroup.style.visibility = "visible";
    }
    const hint = input.protectionDiv.querySelector<HTMLElement>(
        ".password-container p",
    );
    if (hint?.hasAttribute("data-original-text")) {
        hint.textContent = hint.getAttribute("data-original-text") || "";
    }
    input.passwordInput.value = "";
    input.protectionDiv.classList.remove("auto-unlocking");
}

function queryElements(): PasswordProtectionElements | null {
    const protectionDiv = document.getElementById("password-protection");
    const passwordInput = document.getElementById("password-input");
    const unlockBtn = document.getElementById("unlock-btn");
    const errorMessage = document.getElementById("error-message");
    const contentDiv = document.getElementById("decrypted-content");
    const contentBodyDiv = document.getElementById("decrypted-content-body");
    if (
        !(protectionDiv instanceof HTMLElement) ||
        !(passwordInput instanceof HTMLInputElement) ||
        !(unlockBtn instanceof HTMLButtonElement) ||
        !(errorMessage instanceof HTMLElement) ||
        !(contentDiv instanceof HTMLElement) ||
        !(contentBodyDiv instanceof HTMLElement)
    ) {
        return null;
    }
    return {
        protectionDiv,
        passwordInput,
        unlockBtn,
        errorMessage,
        contentDiv,
        contentBodyDiv,
    };
}

function readConfig(protectionDiv: HTMLElement): PasswordProtectionConfig {
    const dataset = protectionDiv.dataset;
    return {
        encryptedContent: String(dataset.encryptedContent || ""),
        ownerUserId: String(dataset.ownerUserId || "").trim(),
        ownerPasswordStorageKeys: normalizeOwnerStorageKeys(
            String(dataset.ownerPasswordStorageKeys || "[]"),
        ),
        i18nUnlocking: String(dataset.i18nUnlocking || "Unlocking..."),
        i18nIncorrect: String(dataset.i18nIncorrect || "Incorrect password."),
        i18nUnlock: String(dataset.i18nUnlock || "Unlock"),
        i18nPasswordRequired: String(
            dataset.i18nPasswordRequired || "Password is required.",
        ),
        i18nDecryptionError: String(
            dataset.i18nDecryptionError || "Decryption failed.",
        ),
        i18nPasswordDecryptRetry: String(
            dataset.i18nPasswordDecryptRetry ||
                "Decryption failed, please try again.",
        ),
    };
}

function initPasswordProtection(): void {
    const els = queryElements();
    if (!els) {
        return;
    }
    const {
        protectionDiv,
        passwordInput,
        unlockBtn,
        errorMessage,
        contentDiv,
        contentBodyDiv,
    } = els;
    if (protectionDiv.dataset.passwordProtectionInited === "1") {
        return;
    }
    protectionDiv.dataset.passwordProtectionInited = "1";

    const config = readConfig(protectionDiv);
    let isViewerOwner = false;
    let autoUnlockPassword = "";
    let hasAutoUnlockTriggered = false;
    let isDecrypting = false;

    const tryRefreshAutoUnlockPassword = (): void => {
        autoUnlockPassword = resolveStoredPassword(
            config.ownerPasswordStorageKeys,
            isViewerOwner,
        );
    };

    const stopOwnerSync = bindPasswordProtectionOwnerSync(
        config.ownerUserId,
        (nextIsOwner) => {
            const previousIsOwner = isViewerOwner;
            isViewerOwner = nextIsOwner;
            protectionDiv.dataset.viewerIsOwner = nextIsOwner ? "1" : "0";
            if (previousIsOwner === nextIsOwner) {
                return;
            }
            tryRefreshAutoUnlockPassword();
            if (
                !hasAutoUnlockTriggered &&
                autoUnlockPassword &&
                protectionDiv.isConnected
            ) {
                applyAutoUnlockingState(
                    protectionDiv,
                    autoUnlockPassword,
                    config.i18nUnlocking,
                );
                hasAutoUnlockTriggered = true;
                void attemptUnlock();
            }
        },
    );

    function showError(message: string): void {
        errorMessage.textContent = message;
        errorMessage.style.display = "block";
        if (!protectionDiv.classList.contains("auto-unlocking")) {
            passwordInput.focus();
        }
    }

    async function attemptUnlock(): Promise<void> {
        const inputPassword = passwordInput.value.trim() || autoUnlockPassword;
        if (!inputPassword) {
            showError(config.i18nPasswordRequired);
            return;
        }
        isDecrypting = true;
        unlockBtn.disabled = true;
        unlockBtn.textContent = config.i18nUnlocking;
        errorMessage.style.display = "none";
        try {
            const protectionHelpers = requireProtectionHelpers();
            const realContent = await protectionHelpers.decryptPayloadV2(
                config.encryptedContent,
                inputPassword,
            );
            const safeHtml = protectionHelpers.sanitizeDecryptedHtml(
                protectionHelpers.resolveProtectedHtml(realContent),
            );
            contentBodyDiv.innerHTML = safeHtml;
            contentDiv.style.display = "block";
            document
                .querySelectorAll("#share-component, .detail-share-btn")
                .forEach((shareEl) => {
                    shareEl.classList.remove("encrypted-hidden");
                });
            sessionStorage.setItem(
                `page-password-${window.location.pathname}`,
                inputPassword,
            );
            persistOwnerStoredPassword(
                config.ownerPasswordStorageKeys,
                inputPassword,
                isViewerOwner,
            );
            stopOwnerSync();
            protectionDiv.remove();
            setTimeout(async () => {
                await protectionHelpers.dispatchPostDecryptTasks(
                    contentBodyDiv,
                );
            }, 50);
        } catch (error) {
            if (isPasswordInvalidError(error)) {
                showError(config.i18nIncorrect);
                rollbackAutoUnlockState({
                    protectionDiv,
                    attemptedPassword: autoUnlockPassword,
                    ownerStorageKeys: config.ownerPasswordStorageKeys,
                    isViewerOwner,
                    passwordInput,
                });
                autoUnlockPassword = "";
                hasAutoUnlockTriggered = false;
                return;
            }
            rollbackAutoUnlockState({
                protectionDiv,
                attemptedPassword: autoUnlockPassword,
                ownerStorageKeys: config.ownerPasswordStorageKeys,
                isViewerOwner,
                passwordInput,
            });
            autoUnlockPassword = "";
            hasAutoUnlockTriggered = false;
            console.error(config.i18nDecryptionError, error);
            showError(config.i18nPasswordDecryptRetry);
        } finally {
            isDecrypting = false;
            unlockBtn.disabled = false;
            unlockBtn.textContent = config.i18nUnlock;
        }
    }

    unlockBtn.addEventListener("click", () => {
        autoUnlockPassword = "";
        void attemptUnlock();
    });
    passwordInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            autoUnlockPassword = "";
            void attemptUnlock();
        }
    });

    tryRefreshAutoUnlockPassword();
    if (autoUnlockPassword) {
        applyAutoUnlockingState(
            protectionDiv,
            autoUnlockPassword,
            config.i18nUnlocking,
        );
        hasAutoUnlockTriggered = true;
        void attemptUnlock();
    } else if (!isDecrypting) {
        passwordInput.focus();
    }
}

type PasswordProtectionRuntimeWindow = Window &
    typeof globalThis & {
        __passwordProtectionSwapInitBound?: boolean;
    };

const runtimeWindow = window as PasswordProtectionRuntimeWindow;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPasswordProtection, {
        once: true,
    });
} else {
    initPasswordProtection();
}

if (!runtimeWindow.__passwordProtectionSwapInitBound) {
    runtimeWindow.__passwordProtectionSwapInitBound = true;
    document.addEventListener("astro:after-swap", initPasswordProtection);
}
