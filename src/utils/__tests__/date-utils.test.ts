import { describe, expect, it } from "vitest";

import { defaultSiteSettings, systemSiteConfig } from "@/config";
import type { ResolvedSiteSettings } from "@/types/site-settings";
import {
    buildSiteDateFormatContext,
    canonicalizeSiteTimeZone,
    formatSiteDate,
    formatSiteDateTime,
    resolveEffectiveSiteTimeZone,
    resolveEnvironmentTimeZone,
} from "@/utils/date-utils";

const BASE_RESOLVED_SETTINGS: ResolvedSiteSettings = {
    system: {
        ...systemSiteConfig,
        lang: "zh_CN",
        timeZone: "Asia/Shanghai",
    },
    settings: defaultSiteSettings,
};

describe("date-utils site time zone helpers", () => {
    it("格式化详情页时间为站点时区的 24 小时制", () => {
        expect(
            formatSiteDateTime("2026-03-11T12:40:00.000Z", {
                locale: "zh-CN",
                timeZone: "Asia/Shanghai",
            }),
        ).toBe("2026/03/11 · 20:40");
        expect(
            formatSiteDateTime("2026-03-11T12:40:00.000Z", {
                locale: "zh-CN",
                timeZone: "UTC",
            }),
        ).toBe("2026/03/11 · 12:40");
    });

    it("跨日时会按目标时区修正日期", () => {
        const input = "2026-03-11T01:05:00.000Z";
        const context = {
            locale: "en-US",
            timeZone: "America/Los_Angeles",
        };
        expect(formatSiteDate(input, context)).toBe("2026/03/10");
        expect(formatSiteDateTime(input, context)).toBe("2026/03/10 · 18:05");
    });

    it("支持显式 UTC 并在未配置时回退到环境时区", () => {
        expect(canonicalizeSiteTimeZone("UTC")).toBe("UTC");
        expect(resolveEffectiveSiteTimeZone(null)).toBe(
            resolveEnvironmentTimeZone(),
        );
    });

    it("可从运行时设置构造统一日期上下文", () => {
        expect(buildSiteDateFormatContext(BASE_RESOLVED_SETTINGS)).toEqual({
            locale: "zh-CN",
            timeZone: "Asia/Shanghai",
        });
    });
});
