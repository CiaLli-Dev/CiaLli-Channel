import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultSiteSettings } from "@/config";

const { cacheGetMock, cacheSetMock, readManyMock } = vi.hoisted(() => ({
    cacheGetMock: vi.fn(),
    cacheSetMock: vi.fn(),
    readManyMock: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: cacheGetMock,
        set: cacheSetMock,
    },
}));

vi.mock("@/server/directus/client", () => ({
    readMany: readManyMock,
    runWithDirectusServiceAccess: async <T>(task: () => Promise<T>) =>
        await task(),
}));

import { resolveSiteSettingsPayload } from "@/server/site-settings/service";

describe("resolveSiteSettingsPayload", () => {
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

        resolveSiteRead?.([
            {
                settings: {},
                date_updated: "2026-03-11T00:00:00.000Z",
                date_created: "2026-03-10T00:00:00.000Z",
            },
        ]);
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

    it("回源失败后使用最后一次成功值而非默认值", async () => {
        const customTitle = "My Custom Site";
        let siteReadCount = 0;
        let announcementReadCount = 0;
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                siteReadCount += 1;
                if (siteReadCount === 1) {
                    return Promise.resolve([
                        {
                            settings: { site: { title: customTitle } },
                            date_updated: "2026-03-11T00:00:00.000Z",
                            date_created: "2026-03-10T00:00:00.000Z",
                        },
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
                        settings: {
                            site: { title: "Site A" },
                            announcement: {
                                title: "旧公告",
                                summary: "旧摘要",
                                body_markdown: "旧正文",
                                closable: false,
                            },
                        },
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
                        settings: {
                            site: { title: "Site C" },
                        },
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

    it("公告行缺失时回退默认公告，而不是读取旧 settings.announcement", async () => {
        readManyMock.mockImplementation((collection: string) => {
            if (collection === "app_site_settings") {
                return Promise.resolve([
                    {
                        settings: {
                            site: { title: "Site B" },
                            announcement: {
                                title: "遗留公告",
                                summary: "遗留摘要",
                                body_markdown: "遗留正文",
                                closable: false,
                            },
                        },
                        date_updated: "2026-03-11T00:00:00.000Z",
                        date_created: "2026-03-10T00:00:00.000Z",
                    },
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
        expect(resolved.settings.announcement.title).not.toBe("遗留公告");
    });
});
