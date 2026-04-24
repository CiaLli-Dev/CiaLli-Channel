import { describe, expect, it } from "vitest";

import {
    buildRuntimeSiteConfig,
    defaultSiteSettings,
    systemSiteConfig,
} from "@/config";
import { DEFAULT_SITE_THEME_PRESET } from "@/config/theme-presets";

describe("config runtime site config", () => {
    it("systemSiteConfig 会从 APP_PUBLIC_BASE_URL 解析站点 URL", () => {
        expect(systemSiteConfig.siteURL).toBe("https://example.com/");
    });

    it("buildRuntimeSiteConfig 会把站点设置投影为布局运行时配置", () => {
        const runtimeSiteConfig = buildRuntimeSiteConfig(
            systemSiteConfig,
            defaultSiteSettings,
        );

        expect(runtimeSiteConfig).toMatchObject({
            title: defaultSiteSettings.site.title,
            subtitle: defaultSiteSettings.site.subtitle,
            siteURL: systemSiteConfig.siteURL,
            lang: defaultSiteSettings.site.lang,
            themeColor: systemSiteConfig.themeColor,
            pageScaling: systemSiteConfig.pageScaling,
            wallpaperMode: defaultSiteSettings.wallpaperMode,
            banner: defaultSiteSettings.banner,
            toc: defaultSiteSettings.toc,
            favicon: defaultSiteSettings.site.favicon,
        });
    });

    it("默认站点文案已去除博客模板语义", () => {
        expect(defaultSiteSettings.site.subtitle).toBe("内容社区");
        expect(defaultSiteSettings.announcement.summary).toContain(
            "CiaLli 社区",
        );
        expect(defaultSiteSettings.announcement.summary).not.toContain("博客");
        expect(defaultSiteSettings.announcement.body_markdown).toContain(
            "CiaLli 社区",
        );
        expect(defaultSiteSettings.announcement.body_markdown).not.toContain(
            "博客",
        );
    });

    it("根据站点主题预设推导运行时 hue，且默认主题为紫色", () => {
        const defaultRuntime = buildRuntimeSiteConfig(
            systemSiteConfig,
            defaultSiteSettings,
        );
        const purpleRuntime = buildRuntimeSiteConfig(systemSiteConfig, {
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                themePreset: "purple",
            },
        });
        const tealRuntime = buildRuntimeSiteConfig(systemSiteConfig, {
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                themePreset: "teal",
            },
        });

        expect(defaultSiteSettings.site.themePreset).toBe(
            DEFAULT_SITE_THEME_PRESET,
        );
        expect(defaultRuntime.themeColor.hue).toBe(256);
        expect(purpleRuntime.themeColor.hue).toBe(256);
        expect(tealRuntime.themeColor.hue).toBe(174);
        expect(defaultRuntime.themeColor.hue).not.toBe(
            tealRuntime.themeColor.hue,
        );
    });
});
