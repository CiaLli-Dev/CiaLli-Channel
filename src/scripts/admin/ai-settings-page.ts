import { requestApi } from "@/scripts/shared/http-client";

type AiSettingsPayload = {
    enabled?: boolean;
    articleSummaryEnabled?: boolean;
    baseUrl?: string;
    model?: string;
    apiKeyConfigured?: boolean;
};

function asInput(element: Element | null): HTMLInputElement | null {
    return element instanceof HTMLInputElement ? element : null;
}

function asForm(element: Element | null): HTMLFormElement | null {
    return element instanceof HTMLFormElement ? element : null;
}

function getSettings(root: HTMLElement): {
    endpoint: string;
    savedText: string;
    failedText: string;
} {
    return {
        endpoint: root.dataset.endpoint || "/api/v1/admin/ai/settings",
        savedText: root.dataset.savedText || "AI settings saved",
        failedText: root.dataset.failedText || "Failed to save AI settings",
    };
}

type AiSettingsElements = {
    enabledInput: HTMLInputElement | null;
    articleSummaryInput: HTMLInputElement | null;
    baseUrlInput: HTMLInputElement | null;
    modelInput: HTMLInputElement | null;
    apiKeyInput: HTMLInputElement | null;
    stateEl: HTMLElement | null;
    messageEl?: HTMLElement | null;
};

function syncInputValues(
    settings: AiSettingsPayload | null | undefined,
    elements: AiSettingsElements,
): void {
    if (elements.enabledInput) {
        elements.enabledInput.checked = Boolean(settings?.enabled);
    }
    if (elements.articleSummaryInput) {
        elements.articleSummaryInput.checked = Boolean(
            settings?.articleSummaryEnabled,
        );
    }
    if (elements.baseUrlInput) {
        elements.baseUrlInput.value = String(settings?.baseUrl || "");
    }
    if (elements.modelInput) {
        elements.modelInput.value = String(settings?.model || "");
    }
    if (elements.apiKeyInput) {
        elements.apiKeyInput.value = "";
    }
}

function syncApiKeyState(
    settings: AiSettingsPayload | null | undefined,
    stateEl: HTMLElement | null,
): void {
    if (!stateEl) {
        return;
    }
    const configured = Boolean(settings?.apiKeyConfigured);
    stateEl.textContent = configured
        ? stateEl.dataset.configuredLabel || ""
        : stateEl.dataset.missingLabel || "";
}

function applySettings(
    settings: AiSettingsPayload | null | undefined,
    elements: AiSettingsElements,
): void {
    syncInputValues(settings, elements);
    syncApiKeyState(settings, elements.stateEl);
}

function buildPayload(
    elements: AiSettingsElements,
    clearApiKey: boolean,
): Record<string, unknown> {
    return {
        enabled: elements.enabledInput?.checked ?? false,
        articleSummaryEnabled: elements.articleSummaryInput?.checked ?? false,
        baseUrl: elements.baseUrlInput?.value ?? "",
        model: elements.modelInput?.value ?? "",
        apiKey: elements.apiKeyInput?.value ?? "",
        clearApiKey,
    };
}

function readApiSettings(
    data: Record<string, unknown> | null,
): AiSettingsPayload {
    const settings = data?.settings;
    return settings && typeof settings === "object"
        ? (settings as AiSettingsPayload)
        : {};
}

async function initAdminAiSettingsPage(root: HTMLElement): Promise<void> {
    const runtime = getSettings(root);
    const form = asForm(root.querySelector("#admin-ai-settings-form"));
    const elements = {
        enabledInput: asInput(root.querySelector("#admin-ai-enabled")),
        articleSummaryInput: asInput(
            root.querySelector("#admin-ai-article-summary-enabled"),
        ),
        baseUrlInput: asInput(root.querySelector("#admin-ai-base-url")),
        modelInput: asInput(root.querySelector("#admin-ai-model")),
        apiKeyInput: asInput(root.querySelector("#admin-ai-api-key")),
        stateEl: root.querySelector<HTMLElement>("#admin-ai-api-key-state"),
        messageEl: root.querySelector<HTMLElement>("#admin-ai-message"),
    };

    const setMessage = (message: string): void => {
        if (elements.messageEl) {
            elements.messageEl.textContent = message;
        }
    };

    const { response, data } = await requestApi(runtime.endpoint);
    if (response.ok && data?.ok) {
        applySettings(readApiSettings(data), elements);
    }

    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        void (async () => {
            const result = await requestApi(runtime.endpoint, {
                method: "PATCH",
                body: JSON.stringify(buildPayload(elements, false)),
            });
            if (!result.response.ok || !result.data?.ok) {
                setMessage(runtime.failedText);
                return;
            }
            applySettings(readApiSettings(result.data), elements);
            setMessage(runtime.savedText);
        })();
    });

    root.querySelector("#admin-ai-clear-api-key")?.addEventListener(
        "click",
        () => {
            void (async () => {
                const result = await requestApi(runtime.endpoint, {
                    method: "PATCH",
                    body: JSON.stringify(buildPayload(elements, true)),
                });
                if (!result.response.ok || !result.data?.ok) {
                    setMessage(runtime.failedText);
                    return;
                }
                applySettings(readApiSettings(result.data), elements);
                setMessage(runtime.savedText);
            })();
        },
    );
}

document
    .querySelectorAll<HTMLElement>("[data-admin-ai-settings-root]")
    .forEach((root) => {
        void initAdminAiSettingsPage(root);
    });
