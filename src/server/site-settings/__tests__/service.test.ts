import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultSiteSettings } from "@/config";
import { DEFAULT_SITE_THEME_PRESET } from "@/config/theme-presets";

const { cacheGetMock, cacheSetMock, cacheInvalidateMock, readManyMock } =
    vi.hoisted(() => ({
        cacheGetMock: vi.fn(),
        cacheSetMock: vi.fn(),
        cacheInvalidateMock: vi.fn(),
        readManyMock: vi.fn(),
    }));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: cacheGetMock,
        set: cacheSetMock,
        invalidate: cacheInvalidateMock,
    },
}));

vi.mock("@/server/directus/client", () => ({
    readMany: readManyMock,
    runWithDirectusServiceAccess: async <T>(task: () => Promise<T>) =>
        await task(),
}));

import {
    resolveRequestSiteSettings,
    resolveSiteSettingsPayload,
} from "@/server/site-settings/service";

function siteSettingsRow(
    sections: {
        settings_site?: Record<string, unknown>;
        settings_nav?: Record<string, unknown>;
        settings_home?: Record<string, unknown>;
        settings_article?: Record<string, unknown>;
        settings_other?: Record<string, unknown>;
        theme_preset?: string;
    } = {},
): Record<string, unknown> {
    return {
        settings_site: sections.settings_site ?? {},
        settings_nav: sections.settings_nav ?? {},
        settings_home: sections.settings_home ?? {},
        settings_article: sections.settings_article ?? {},
        settings_other: sections.settings_other ?? {},
        theme_preset: sections.theme_preset ?? DEFAULT_SITE_THEME_PRESET,
        date_updated: "2026-03-11T00:00:00.000Z",
        date_created: "2026-03-10T00:00:00.000Z",
    };
}

function fullSectionedSiteSettingsRow(): Record<string, unknown> {
    return siteSettingsRow({
        settings_site: {
            site: {
                title: "Sectioned Site",
                subtitle: "Split JSON",
                lang: "zh_CN",
                timeZone: "Asia/Shanghai",
                keywords: ["split"],
                siteStartDate: "2026-04-20",
                favicon: [],
            },
            auth: {
                register_enabled: true,
            },
            profile: {
                avatar: "assets/images/avatar.webp",
            },
        },
        settings_nav: {
            navbarTitle: {
                mode: "logo",
                text: "Nav Title",
                icon: "assets/home/home.png",
                logo: "assets/home/default-logo.png",
            },
            navBar: {
                links: [],
            },
            banner: {
                navbar: {
                    transparentMode: "full",
                },
            },
        },
        settings_home: {
            wallpaperMode: {
                defaultMode: "banner",
            },
            banner: {
                src: ["/banner.jpg"],
                position: "bottom",
                carousel: {
                    enable: true,
                    interval: 8,
                },
                waves: {
                    enable: true,
                },
                homeText: {
                    enable: true,
                    title: "Home Text",
                    subtitle: ["Line"],
                    typewriter: {
                        enable: true,
                        speed: 90,
                        deleteSpeed: 40,
                        pauseTime: 1800,
                    },
                },
            },
        },
        settings_article: {
            toc: {
                enable: true,
                mode: "sidebar",
                depth: 3,
                useJapaneseBadge: true,
            },
        },
        settings_other: {
            musicPlayer: {
                enable: false,
                meting_api: "https://example.com/meting",
                id: "playlist",
                server: "netease",
                type: "playlist",
                marqueeSpeed: 12,
            },
        },
        theme_preset: "purple",
    });
}

function createLegacyResolvedSiteSettings(): {
    system: {
        siteURL: string;
        lang: "zh_CN";
        timeZone: string;
        themeColor: {
            hue: number;
        };
        pageScaling: {
            targetWidth: number;
        };
        expressiveCode: {
            theme: string;
            hideDuringThemeTransition: boolean;
        };
    };
    settings: Record<string, unknown>;
} {
    return {
        system: {
            siteURL: "https://example.com/",
            lang: "zh_CN",
            timeZone: "Asia/Shanghai",
            themeColor: {
                hue: 256,
            },
            pageScaling: {
                targetWidth: 2000,
            },
            expressiveCode: {
                theme: "github-dark",
                hideDuringThemeTransition: true,
            },
        },
        settings: {
            ...structuredClone(defaultSiteSettings),
            banner: {
                ...structuredClone(defaultSiteSettings.banner),
                waves: {
                    enable: true,
                    performanceMode: false,
                },
                imageApi: {
                    enable: false,
                    url: "http://domain.com/api_v2.php?format=text&count=4",
                },
            },
            umami: {
                enabled: false,
            },
            footer: {
                enable: false,
            },
            featurePages: {
                friends: true,
            },
        },
    };
}

describe("resolveSiteSettingsPayload", () => {
    it("缺失主题预设时回退为紫色默认主题", () => {
        const result = resolveSiteSettingsPayload({
            site: {
                title: "No Theme",
            },
        });

        expect(result.site.themePreset).toBe(DEFAULT_SITE_THEME_PRESET);
    });

    it("非法主题预设会回退为紫色默认主题", () => {
        const result = resolveSiteSettingsPayload({
            site: {
                themePreset: "pink",
            },
        });

        expect(result.site.themePreset).toBe(DEFAULT_SITE_THEME_PRESET);
    });

    it("合法主题预设会被保留", () => {
        const result = resolveSiteSettingsPayload({
            site: {
                themePreset: "orange",
            },
        });

        expect(result.site.themePreset).toBe("orange");
    });

    it("允许将站点时区从 null 更新为显式字符串", () => {
        const base = {
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                timeZone: null,
            },
        };

        const result = resolveSiteSettingsPayload(
            {
                site: {
                    timeZone: "UTC",
                },
            },
            base,
        );

        expect(result.site.timeZone).toBe("UTC");
    });

    it("允许将站点时区从显式字符串清空为 null", () => {
        const base = {
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                timeZone: "Asia/Shanghai",
            },
        };

        const result = resolveSiteSettingsPayload(
            {
                site: {
                    timeZone: null,
                },
            },
            base,
        );

        expect(result.site.timeZone).toBeNull();
    });

    it("会将非法时区字符串归一化为 null", () => {
        const result = resolveSiteSettingsPayload({
            site: {
                timeZone: "Mars/Olympus",
            },
        });

        expect(result.site.timeZone).toBeNull();
    });

    it("会在归一化阶段剔除历史 analytics 字段", () => {
        const result = resolveSiteSettingsPayload({
            analytics: {
                gtmId: "GTM-XXXXXXX",
                clarityId: "abcd1234",
            },
        });

        expect(
            Object.prototype.hasOwnProperty.call(
                result as Record<string, unknown>,
                "analytics",
            ),
        ).toBe(false);
    });

    it("会在归一化阶段剔除历史 sakura 字段", () => {
        const result = resolveSiteSettingsPayload({
            sakura: {
                enable: true,
            },
        });

        expect(
            Object.prototype.hasOwnProperty.call(
                result as Record<string, unknown>,
                "sakura",
            ),
        ).toBe(false);
    });

    it("会在归一化阶段剔除历史 banner.imageApi 并保留横幅文案", () => {
        const result = resolveSiteSettingsPayload({
            banner: {
                imageApi: {
                    enable: true,
                    url: "https://example.com/banner.txt",
                },
                homeText: {
                    enable: true,
                    title: "首页标题",
                    subtitle: ["第一行", "第二行"],
                    typewriter: {
                        enable: true,
                        speed: 90,
                        deleteSpeed: 40,
                        pauseTime: 1800,
                    },
                },
            },
        });

        expect(
            Object.prototype.hasOwnProperty.call(
                result.banner as Record<string, unknown>,
                "imageApi",
            ),
        ).toBe(false);
        expect(result.banner.homeText).toEqual({
            enable: true,
            title: "首页标题",
            subtitle: ["第一行", "第二行"],
            typewriter: {
                enable: true,
                speed: 90,
                deleteSpeed: 40,
                pauseTime: 1800,
            },
        });
    });

    it("会在归一化阶段剔除历史 banner.waves.performanceMode 并保留波浪开关", () => {
        const result = resolveSiteSettingsPayload({
            banner: {
                waves: {
                    enable: true,
                    performanceMode: false,
                },
            },
        });

        expect(result.banner.waves).toEqual({
            enable: true,
        });
        expect(
            Object.prototype.hasOwnProperty.call(
                (result.banner.waves ?? {}) as Record<string, unknown>,
                "performanceMode",
            ),
        ).toBe(false);
    });

    it("关闭波浪效果时会在归一化后保留 false，不回退默认 true", () => {
        const result = resolveSiteSettingsPayload({
            banner: {
                waves: {
                    enable: false,
                },
            },
        });

        expect(result.banner.waves).toEqual({
            enable: false,
        });
    });
});

describe("site-settings/service", () => {
    beforeEach(() => {
        vi.resetModules();
        cacheGetMock.mockReset();
        cacheSetMock.mockReset();
        readManyMock.mockReset();
        cacheGetMock.mockResolvedValue(null);
        cacheSetMock.mockResolvedValue(undefined);
        readManyMock.mockImplementation(async () => []);
    });

    it("读取时仅使用 theme_preset 列，忽略 settings.site.themePreset", async () => {
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                return Promise.resolve([
                    siteSettingsRow({
                        settings_site: {
                            site: {
                                title: "Theme Test",
                                themePreset: "orange",
                            },
                        },
                        theme_preset: "teal",
                    }),
                ]);
            }
            if (collection === "app_site_announcements") {
                return Promise.resolve([]);
            }
            return Promise.resolve([]);
        });

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");
        const resolved = await getResolvedSiteSettings();

        expect(resolved.settings.site.title).toBe("Theme Test");
        expect(resolved.settings.site.themePreset).toBe("teal");
    });

    it("从 Directus 分区字段组装完整站点设置", async () => {
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                return Promise.resolve([fullSectionedSiteSettingsRow()]);
            }
            if (collection === "app_site_announcements") {
                return Promise.resolve([]);
            }
            return Promise.resolve([]);
        });

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");
        const resolved = await getResolvedSiteSettings();

        expect(resolved.settings.site.title).toBe("Sectioned Site");
        expect(resolved.settings.site.themePreset).toBe("purple");
        expect(resolved.settings.navbarTitle?.text).toBe("Nav Title");
        expect(resolved.settings.banner.src).toEqual(["/banner.jpg"]);
        expect(resolved.settings.banner.position).toBe("bottom");
        expect(resolved.settings.banner.navbar?.transparentMode).toBe("full");
        expect(resolved.settings.toc.depth).toBe(3);
        expect(resolved.settings.musicPlayer.enable).toBe(false);
    });

    it("从 Directus 分区字段读取时会保留关闭后的波浪效果配置", async () => {
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                const row = fullSectionedSiteSettingsRow();
                const settingsHome = row.settings_home as {
                    banner: {
                        waves: {
                            enable: boolean;
                        };
                    };
                };
                settingsHome.banner.waves.enable = false;
                return Promise.resolve([row]);
            }
            if (collection === "app_site_announcements") {
                return Promise.resolve([]);
            }
            return Promise.resolve([]);
        });

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");
        const resolved = await getResolvedSiteSettings();

        expect(resolved.settings.banner.waves?.enable).toBe(false);
    });

    it("缓存失效会等待底层缓存删除完成", async () => {
        let finishInvalidate: (() => void) | undefined;
        const invalidateFinished = new Promise<void>((resolve) => {
            finishInvalidate = resolve;
        });
        const events: string[] = [];
        cacheInvalidateMock.mockImplementationOnce(async () => {
            events.push("invalidate-start");
            await invalidateFinished;
            events.push("invalidate-done");
        });

        const { invalidateSiteSettingsCache } =
            await import("@/server/site-settings/service");
        const invalidateTask = invalidateSiteSettingsCache();
        expect(invalidateTask).toBeInstanceOf(Promise);
        await Promise.resolve();
        events.push("after-call");

        finishInvalidate?.();
        await invalidateTask;

        expect(events).toEqual([
            "invalidate-start",
            "after-call",
            "invalidate-done",
        ]);
    });
});

describe("site-settings/service cache", () => {
    beforeEach(() => {
        vi.resetModules();
        cacheGetMock.mockReset();
        cacheSetMock.mockReset();
        readManyMock.mockReset();
        cacheGetMock.mockResolvedValue(null);
        cacheSetMock.mockResolvedValue(undefined);
        readManyMock.mockImplementation(async () => []);
    });

    it("缓存 miss 时并发请求只回源一次", async () => {
        let resolveSiteRead:
            | ((value: Array<Record<string, unknown>>) => void)
            | undefined;
        let resolveAnnouncementRead:
            | ((value: Array<Record<string, unknown>>) => void)
            | undefined;
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                return new Promise<Array<Record<string, unknown>>>(
                    (resolve) => {
                        resolveSiteRead = resolve;
                    },
                );
            }
            if (collection === "app_site_announcements") {
                return new Promise<Array<Record<string, unknown>>>(
                    (resolve) => {
                        resolveAnnouncementRead = resolve;
                    },
                );
            }
            return Promise.resolve([]);
        });

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");
        const firstTask = getResolvedSiteSettings();
        const secondTask = getResolvedSiteSettings();
        const thirdTask = getResolvedSiteSettings();

        await Promise.resolve();
        expect(readManyMock).toHaveBeenCalledTimes(2);

        resolveSiteRead?.([siteSettingsRow()]);
        resolveAnnouncementRead?.([]);

        const [first, second, third] = await Promise.all([
            firstTask,
            secondTask,
            thirdTask,
        ]);

        expect(first.settings).toEqual(second.settings);
        expect(second.settings).toEqual(third.settings);
        expect(readManyMock).toHaveBeenCalledTimes(2);
    });

    it("回源失败后在退避窗口内不重复访问 Directus", async () => {
        readManyMock.mockRejectedValue(new Error("fetch failed"));

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");

        const first = await getResolvedSiteSettings();
        const second = await getResolvedSiteSettings();

        expect(first.settings.site.title).toBe(second.settings.site.title);
        expect(readManyMock).toHaveBeenCalledTimes(2);
    });

    it("请求上下文命中 legacy site settings 时会回源当前规范化配置", async () => {
        const freshResolved = {
            system: {
                siteURL: "https://example.com/",
                lang: "zh_CN" as const,
                timeZone: "Asia/Shanghai",
                themeColor: {
                    hue: 256,
                },
                pageScaling: {
                    targetWidth: 2000,
                },
                expressiveCode: {
                    theme: "github-dark",
                    hideDuringThemeTransition: true,
                },
            },
            settings: {
                ...structuredClone(defaultSiteSettings),
                banner: {
                    ...structuredClone(defaultSiteSettings.banner),
                    waves: {
                        enable: false,
                    },
                },
            },
        };
        cacheGetMock.mockResolvedValueOnce({
            resolved: freshResolved,
            updatedAt: "2026-04-20T14:00:58.808Z",
        });

        const result = await resolveRequestSiteSettings(
            createLegacyResolvedSiteSettings() as never,
        );

        expect(result.settings.banner.waves?.enable).toBe(false);
        expect(
            Object.prototype.hasOwnProperty.call(
                result.settings as Record<string, unknown>,
                "featurePages",
            ),
        ).toBe(false);
        expect(cacheGetMock).toHaveBeenCalledWith("site-settings", "default");
    });

    it("请求上下文命中当前 schema 的 site settings 时直接复用", async () => {
        const freshResolved = {
            system: {
                siteURL: "https://example.com/",
                lang: "zh_CN" as const,
                timeZone: "Asia/Shanghai",
                themeColor: {
                    hue: 256,
                },
                pageScaling: {
                    targetWidth: 2000,
                },
                expressiveCode: {
                    theme: "github-dark",
                    hideDuringThemeTransition: true,
                },
            },
            settings: {
                ...structuredClone(defaultSiteSettings),
                banner: {
                    ...structuredClone(defaultSiteSettings.banner),
                    waves: {
                        enable: false,
                    },
                },
            },
        };

        const result = await resolveRequestSiteSettings(freshResolved);

        expect(result).toBe(freshResolved);
        expect(cacheGetMock).not.toHaveBeenCalled();
    });

    it("回源失败后使用最后一次成功值而非默认值", async () => {
        const customTitle = "My Custom Site";
        let siteReadCount = 0;
        let announcementReadCount = 0;
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                siteReadCount += 1;
                if (siteReadCount === 1) {
                    return Promise.resolve([
                        siteSettingsRow({
                            settings_site: {
                                site: { title: customTitle },
                            },
                        }),
                    ]);
                }
                return Promise.reject(new Error("fetch failed"));
            }
            if (collection === "app_site_announcements") {
                announcementReadCount += 1;
                if (announcementReadCount === 1) {
                    return Promise.resolve([]);
                }
                return Promise.reject(new Error("fetch failed"));
            }
            return Promise.resolve([]);
        });

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");

        // 第一次调用：成功加载自定义设置
        const first = await getResolvedSiteSettings();
        expect(first.settings.site.title).toBe(customTitle);

        // 第二次调用：回源失败，应返回最后一次成功值而非默认值
        const second = await getResolvedSiteSettings();
        expect(second.settings.site.title).toBe(customTitle);
        expect(second.settings.site.title).not.toBe(
            defaultSiteSettings.site.title,
        );
    });

    it("公告应从 app_site_announcements 注入，覆盖旧 settings.announcement", async () => {
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                return Promise.resolve([
                    {
                        settings_site: {
                            site: { title: "Site A" },
                        },
                        settings_nav: {},
                        settings_home: {},
                        settings_article: {},
                        settings_other: {},
                        date_updated: "2026-03-11T00:00:00.000Z",
                        date_created: "2026-03-10T00:00:00.000Z",
                    },
                ]);
            }
            if (collection === "app_site_announcements") {
                return Promise.resolve([
                    {
                        key: "default",
                        title: "新公告",
                        summary: "新摘要",
                        body_markdown: "# 新正文",
                        closable: true,
                        date_updated: "2026-03-12T00:00:00.000Z",
                        date_created: "2026-03-11T00:00:00.000Z",
                    },
                ]);
            }
            return Promise.resolve([]);
        });

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");
        const resolved = await getResolvedSiteSettings();

        expect(resolved.settings.site.title).toBe("Site A");
        expect(resolved.settings.announcement.title).toBe("新公告");
        expect(resolved.settings.announcement.summary).toBe("新摘要");
        expect(resolved.settings.announcement.body_markdown).toBe("# 新正文");
    });

    it("公告状态非 published 时，前台仍应回退读取 key=default 公告", async () => {
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                return Promise.resolve([
                    {
                        settings_site: {
                            site: { title: "Site C" },
                        },
                        settings_nav: {},
                        settings_home: {},
                        settings_article: {},
                        settings_other: {},
                        date_updated: "2026-03-11T00:00:00.000Z",
                        date_created: "2026-03-10T00:00:00.000Z",
                    },
                ]);
            }
            if (collection === "app_site_announcements") {
                return Promise.resolve([
                    {
                        key: "default",
                        status: "draft",
                        title: "草稿公告",
                        summary: "草稿摘要",
                        body_markdown: "# 草稿正文",
                        closable: false,
                        date_updated: "2026-03-12T00:00:00.000Z",
                        date_created: "2026-03-11T00:00:00.000Z",
                    },
                ]);
            }
            return Promise.resolve([]);
        });

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");
        const resolved = await getResolvedSiteSettings();

        expect(resolved.settings.site.title).toBe("Site C");
        expect(resolved.settings.announcement.title).toBe("草稿公告");
        expect(resolved.settings.announcement.summary).toBe("草稿摘要");
        expect(resolved.settings.announcement.body_markdown).toBe("# 草稿正文");
    });

    it("公告行缺失时回退默认公告", async () => {
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                return Promise.resolve([
                    siteSettingsRow({
                        settings_site: {
                            site: { title: "Site B" },
                        },
                    }),
                ]);
            }
            if (collection === "app_site_announcements") {
                return Promise.resolve([]);
            }
            return Promise.resolve([]);
        });

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");
        const resolved = await getResolvedSiteSettings();

        expect(resolved.settings.site.title).toBe("Site B");
        expect(resolved.settings.announcement).toEqual(
            defaultSiteSettings.announcement,
        );
    });
});
