export const EDITOR_SAVE_FRESHNESS_PARAM = "editor_fresh";

const EDITOR_SAVE_FRESHNESS_BASE = "https://editor-save.local";

function buildEditorSaveFreshnessToken(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function appendEditorSaveFreshnessParam(
    url: string,
    token?: string,
): string {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
        return "";
    }

    try {
        const parsed = new URL(normalizedUrl, EDITOR_SAVE_FRESHNESS_BASE);
        parsed.searchParams.set(
            EDITOR_SAVE_FRESHNESS_PARAM,
            String(token || buildEditorSaveFreshnessToken()),
        );
        if (parsed.origin === EDITOR_SAVE_FRESHNESS_BASE) {
            return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        return parsed.href;
    } catch {
        return normalizedUrl;
    }
}

export function hasEditorSaveFreshnessParam(url: URL | string): boolean {
    try {
        const parsed =
            typeof url === "string"
                ? new URL(url, EDITOR_SAVE_FRESHNESS_BASE)
                : url;
        return parsed.searchParams.has(EDITOR_SAVE_FRESHNESS_PARAM);
    } catch {
        return false;
    }
}
