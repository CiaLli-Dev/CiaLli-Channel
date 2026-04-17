import { describe, expect, it } from "vitest";

import {
    buildRuntimeSiteConfig,
    defaultSiteSettings,
    systemSiteConfig,
} from "@/config";

describe("config runtime site config", () => {
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
});
