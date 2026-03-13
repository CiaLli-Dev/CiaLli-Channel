import type { Translation } from "@/i18n/translation";

type RuntimeTranslationMap = Partial<Record<keyof Translation, string>>;

type TemplateVariables = Record<string, string | number>;

function getWindowObject(): Window | null {
    if (typeof window === "undefined") {
        return null;
    }
    return window;
}

function getRuntimeMap(): RuntimeTranslationMap {
    const win = getWindowObject();
    return win?.__CIALLI_I18N__ ?? {};
}

/**
 * 运行时取词：优先使用注入词典，未命中时回退到 fallback，再回退 key 本身。
 */
export function t(key: keyof Translation | string, fallback = ""): string {
    const runtimeMap = getRuntimeMap();
    const value = runtimeMap[key as keyof Translation];
    if (typeof value === "string" && value.trim().length > 0) {
        return value;
    }
    if (fallback.trim().length > 0) {
        return fallback;
    }
    return String(key);
}

/**
 * 运行时插值：同时兼容 {name} 和 %{name} 两种占位符格式。
 */
export function tFmt(
    key: keyof Translation | string,
    variables: TemplateVariables,
    fallback = "",
): string {
    const baseText = t(key, fallback);
    return Object.entries(variables).reduce((output, [name, value]) => {
        const replacement = String(value);
        return output
            .replaceAll(`{${name}}`, replacement)
            .replaceAll(`%{${name}}`, replacement);
    }, baseText);
}
