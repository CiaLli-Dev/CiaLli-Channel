import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { systemSiteConfig } from "@/config";
import I18nKey from "@/i18n/i18nKey";
import { getTranslation, i18n } from "@/i18n/translation";
import { registerRequestScopedI18n } from "@/server/request-context/i18n";

import { runWithRequestContext } from "../index";

describe("request context i18n", () => {
    beforeAll(() => {
        registerRequestScopedI18n();
    });

    afterEach(() => {
        // 测试结束后不残留请求上下文，后续用例应回退到默认语言。
    });

    it("并发请求不会串语言", async () => {
        const key = I18nKey.coreHome;
        const [english, japanese] = await Promise.all([
            runWithRequestContext(
                {
                    requestId: "req-en",
                    language: "en",
                },
                async () => {
                    await Promise.resolve();
                    return i18n(key);
                },
            ),
            runWithRequestContext(
                {
                    requestId: "req-ja",
                    language: "ja",
                },
                async () => {
                    await Promise.resolve();
                    return i18n(key);
                },
            ),
        ]);

        expect(english).toBe(getTranslation("en")[key]);
        expect(japanese).toBe(getTranslation("ja")[key]);
    });

    it("脱离请求上下文时回退到默认语言", () => {
        const key = I18nKey.coreHome;
        expect(i18n(key)).toBe(getTranslation(systemSiteConfig.lang)[key]);
    });
});
