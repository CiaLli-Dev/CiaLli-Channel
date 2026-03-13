import { systemSiteConfig } from "@/config";
import type I18nKey from "./i18nKey";
import { en } from "./languages/en";
import { ja } from "./languages/ja";
import { zh_CN } from "./languages/zh_CN";
import { zh_TW } from "./languages/zh_TW";

export type Translation = {
    [K in I18nKey]: string;
};

export type Translator = (key: I18nKey) => string;

const defaultTranslation = en;

let serverLanguageResolver: (() => string) | null = null;

const map: { [key: string]: Translation } = {
    en: en,
    en_us: en,
    en_gb: en,
    en_au: en,
    zh_cn: zh_CN,
    zh_tw: zh_TW,
    ja: ja,
    ja_jp: ja,
};

export function getTranslation(lang: string): Translation {
    return map[lang.toLowerCase()] || defaultTranslation;
}

export function createI18n(lang: string): Translator {
    const translation = getTranslation(lang);
    return (key: I18nKey): string => translation[key];
}

export function setServerLanguageResolver(
    resolver: (() => string) | null,
): void {
    serverLanguageResolver = resolver;
}

export function getCurrentLanguage(): string {
    if (typeof window === "undefined" && serverLanguageResolver) {
        return serverLanguageResolver();
    }
    if (
        typeof window !== "undefined" &&
        window.__CIALLI_RUNTIME_SETTINGS__?.system.lang
    ) {
        return window.__CIALLI_RUNTIME_SETTINGS__.system.lang;
    }
    return systemSiteConfig.lang || "en";
}

export function i18n(key: I18nKey): string {
    if (typeof window !== "undefined" && window.__CIALLI_I18N__) {
        const runtimeValue = window.__CIALLI_I18N__[key];
        if (
            typeof runtimeValue === "string" &&
            runtimeValue.trim().length > 0
        ) {
            return runtimeValue;
        }
    }
    return createI18n(getCurrentLanguage())(key);
}
