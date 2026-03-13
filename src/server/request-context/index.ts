import { AsyncLocalStorage } from "node:async_hooks";

import { systemSiteConfig } from "@/config";
import type { ResolvedSiteSettings } from "@/types/site-settings";

export interface RequestContextState {
    requestId: string;
    language: string;
    siteSettings?: ResolvedSiteSettings;
    isPrerendered?: boolean;
}

const requestContextStorage = new AsyncLocalStorage<RequestContextState>();

/**
 * 统一托管请求级上下文，避免把语言、请求 ID 等状态写回模块级单例。
 */
export async function runWithRequestContext<T>(
    state: RequestContextState,
    task: () => Promise<T>,
): Promise<T> {
    return await requestContextStorage.run(state, task);
}

export function getRequestContext(): RequestContextState | undefined {
    return requestContextStorage.getStore();
}

export function getRequestId(): string | undefined {
    return getRequestContext()?.requestId;
}

export function getRequestSiteSettings(): ResolvedSiteSettings | undefined {
    return getRequestContext()?.siteSettings;
}

export function getRequestLanguage(): string {
    return (
        getRequestContext()?.language ||
        getRequestContext()?.siteSettings?.system.lang ||
        systemSiteConfig.lang ||
        "en"
    );
}
