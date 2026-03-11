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
});

describe("site-settings/service", () => {
    beforeEach(() => {
        vi.resetModules();
        cacheGetMock.mockReset();
        cacheSetMock.mockReset();
        readManyMock.mockReset();
        cacheGetMock.mockResolvedValue(null);
        cacheSetMock.mockResolvedValue(undefined);
    });

    it("缓存 miss 时并发请求只回源一次", async () => {
        let resolveRead:
            | ((value: Array<Record<string, unknown>>) => void)
            | undefined;
        readManyMock.mockImplementation(
            () =>
                new Promise<Array<Record<string, unknown>>>((resolve) => {
                    resolveRead = resolve;
                }),
        );

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");
        const firstTask = getResolvedSiteSettings();
        const secondTask = getResolvedSiteSettings();
        const thirdTask = getResolvedSiteSettings();

        await Promise.resolve();
        expect(readManyMock).toHaveBeenCalledTimes(1);

        resolveRead?.([
            {
                settings: {},
                date_updated: "2026-03-11T00:00:00.000Z",
                date_created: "2026-03-10T00:00:00.000Z",
            },
        ]);

        const [first, second, third] = await Promise.all([
            firstTask,
            secondTask,
            thirdTask,
        ]);

        expect(first.settings).toEqual(second.settings);
        expect(second.settings).toEqual(third.settings);
        expect(readManyMock).toHaveBeenCalledTimes(1);
    });

    it("回源失败后在退避窗口内不重复访问 Directus", async () => {
        readManyMock.mockRejectedValue(new Error("fetch failed"));

        const { getResolvedSiteSettings } =
            await import("@/server/site-settings/service");

        const first = await getResolvedSiteSettings();
        const second = await getResolvedSiteSettings();

        expect(first.settings.site.title).toBe(second.settings.site.title);
        expect(readManyMock).toHaveBeenCalledTimes(1);
    });
});
