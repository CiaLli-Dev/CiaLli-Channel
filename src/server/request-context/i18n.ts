import { setServerLanguageResolver } from "@/i18n/translation";

import { getRequestLanguage } from "./index";

/**
 * 通过稳定的解析器把服务端 i18n 绑定到 request context，
 * 避免前端 bundle 直接依赖 node:async_hooks。
 */
export function registerRequestScopedI18n(): void {
    setServerLanguageResolver(getRequestLanguage);
}
