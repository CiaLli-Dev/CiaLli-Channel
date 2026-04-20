import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminKey } from "@/i18n/keys/admin";
import { enAdmin } from "@/i18n/languages/parts/en/admin";
import { jaAdmin } from "@/i18n/languages/parts/ja/admin";
import { zhCNAdmin } from "@/i18n/languages/parts/zh_CN/admin";
import { zhTWAdmin } from "@/i18n/languages/parts/zh_TW/admin";

const setValMock = vi.fn();
const setSelectMock = vi.fn();
const setCheckedMock = vi.fn();
const inputValMock = vi.fn((id: string) => inputState[id] ?? "");
const textareaValMock = vi.fn((id: string) => textareaState[id] ?? "");
const checkedMock = vi.fn((id: string) => checkedState[id] ?? false);
const numberOrFallbackMock = vi.fn((value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
});

const fillFaviconListMock = vi.fn();
const collectFaviconListMock = vi.fn(
    (_container: unknown): Array<{ src: string }> => [],
);
const fillBannerListMock = vi.fn();
const collectBannerListMock = vi.fn((_container: unknown): string[] => []);
const normalizeBannerEditorListMock = vi.fn(
    (_source: unknown): unknown[] => [],
);
const fillNavLinksMock = vi.fn();
const collectNavLinksMock = vi.fn((_container: unknown): unknown[] => []);

let inputState: Record<string, string> = {};
let textareaState: Record<string, string> = {};
let checkedState: Record<string, boolean> = {};

vi.mock("@/scripts/shared/dom-helpers", () => ({
    inputVal: (id: string) => inputValMock(id),
    textareaVal: (id: string) => textareaValMock(id),
    checked: (id: string) => checkedMock(id),
    setVal: (id: string, value: string) => setValMock(id, value),
    setChecked: (id: string, value: boolean) => setCheckedMock(id, value),
    setSelect: (id: string, value: string) => setSelectMock(id, value),
    numberOrFallback: (value: unknown, fallback: number) =>
        numberOrFallbackMock(value, fallback),
}));

vi.mock("@/scripts/site-settings/page-editor", () => ({
    faviconListContainer: {} as HTMLElement,
    bannerDesktopListContainer: null,
    bannerDesktopDragSource: null,
    fillFaviconList: (items: unknown, container: unknown) =>
        fillFaviconListMock(items, container),
    fillBannerList: (
        items: unknown,
        container: unknown,
        getDragSource: unknown,
        setDragSource: unknown,
    ) => fillBannerListMock(items, container, getDragSource, setDragSource),
    collectFaviconList: (container: unknown) =>
        collectFaviconListMock(container),
    collectBannerList: (container: unknown) => collectBannerListMock(container),
    normalizeBannerEditorList: (source: unknown) =>
        normalizeBannerEditorListMock(source),
}));

vi.mock("@/scripts/site-settings/page-nav", () => ({
    navLinksContainer: null,
    fillNavLinks: (items: unknown, container: unknown) =>
        fillNavLinksMock(items, container),
    collectNavLinks: (container: unknown) => collectNavLinksMock(container),
}));

import {
    bindSettings,
    collectHomePayload,
    collectSitePayload,
} from "@/scripts/site-settings/page-helpers";

const siteHomeSectionSource = readFileSync(
    fileURLToPath(
        new URL(
            "../../components/admin/settings/SiteHomeSection.astro",
            import.meta.url,
        ),
    ),
    "utf8",
);
const mainGridCssSource = readFileSync(
    fileURLToPath(
        new URL("../../styles/main-grid-layout.css", import.meta.url),
    ),
    "utf8",
);
const mainGridLayoutSource = readFileSync(
    fileURLToPath(
        new URL("../../layouts/MainGridLayout.astro", import.meta.url),
    ),
    "utf8",
);

describe("site-settings page helpers theme preset", () => {
    beforeEach(() => {
        inputState = {};
        textareaState = {};
        checkedState = {};
        setValMock.mockReset();
        setSelectMock.mockReset();
        setCheckedMock.mockReset();
        inputValMock.mockClear();
        textareaValMock.mockClear();
        checkedMock.mockClear();
        numberOrFallbackMock.mockClear();
        fillFaviconListMock.mockReset();
        collectFaviconListMock.mockReset();
        fillBannerListMock.mockReset();
        collectBannerListMock.mockReset();
        normalizeBannerEditorListMock.mockReset();
        fillNavLinksMock.mockReset();
        collectNavLinksMock.mockReset();
    });

    it("bindSettings 会回填站点主题预设", () => {
        bindSettings({
            site: {
                title: "CiaLli",
                subtitle: "内容社区",
                lang: "zh_CN",
                timeZone: null,
                themePreset: "orange",
                keywords: ["a", "b"],
                siteStartDate: "2026-02-01",
                favicon: [],
            },
        });

        expect(setSelectMock).toHaveBeenCalledWith("ss-theme-preset", "orange");
    });

    it("collectSitePayload 会写入主题预设并合并关键词与图标", () => {
        inputState = {
            "ss-title": "CiaLli",
            "ss-subtitle": "内容社区",
            "ss-language": "zh_CN",
            "ss-timezone": "UTC",
            "ss-theme-preset": "teal",
            "ss-keywords": "主题, 色彩, Material",
            "ss-start-date": "2026-02-01",
        };
        collectFaviconListMock.mockReturnValueOnce([
            {
                src: "/api/v1/public/assets/file-id",
            },
        ]);

        const payload = collectSitePayload({
            site: {
                favicon: [],
            },
        });

        expect(payload).toEqual({
            site: {
                favicon: [
                    {
                        src: "/api/v1/public/assets/file-id",
                    },
                ],
                keywords: ["主题", "色彩", "Material"],
                lang: "zh_CN",
                siteStartDate: "2026-02-01",
                subtitle: "内容社区",
                themePreset: "teal",
                timeZone: "UTC",
                title: "CiaLli",
            },
        });
    });

    it("collectHomePayload 不再提交横幅 API 且保留横幅文案", () => {
        inputState = {
            "ss-wallpaper-mode": "banner",
            "ss-banner-position": "bottom",
            "ss-banner-carousel-interval": "9",
            "ss-banner-home-text-title": "新的首页标题",
            "ss-banner-home-typewriter-speed": "80",
            "ss-banner-home-typewriter-delete-speed": "35",
            "ss-banner-home-typewriter-pause-time": "1500",
        };
        textareaState = {
            "ss-banner-home-text-subtitle": "第一行\n第二行",
        };
        checkedState = {
            "ss-banner-carousel-enable": true,
            "ss-banner-home-text-enable": true,
            "ss-banner-home-typewriter-enable": true,
            "ss-banner-waves-enable": true,
            "ss-banner-waves-performance": false,
        };

        const payload = collectHomePayload({
            wallpaperMode: {
                defaultMode: "none",
            },
            banner: {
                src: ["/old-banner.jpg"],
                position: "center",
                imageApi: {
                    enable: true,
                    url: "https://example.com/banner-api",
                },
                carousel: {
                    enable: false,
                    interval: 5,
                },
                homeText: {
                    enable: false,
                    title: "旧标题",
                    subtitle: ["旧副标题"],
                    typewriter: {
                        enable: false,
                        speed: 100,
                        deleteSpeed: 50,
                        pauseTime: 2000,
                    },
                },
                waves: {
                    enable: false,
                    performanceMode: true,
                },
            },
        });
        const banner = payload.banner as Record<string, unknown>;

        expect(Object.prototype.hasOwnProperty.call(banner, "imageApi")).toBe(
            false,
        );
        expect(payload).toMatchObject({
            wallpaperMode: {
                defaultMode: "banner",
            },
            banner: {
                position: "bottom",
                src: [],
                carousel: {
                    enable: true,
                    interval: 9,
                },
                homeText: {
                    enable: true,
                    title: "新的首页标题",
                    subtitle: ["第一行", "第二行"],
                    typewriter: {
                        enable: true,
                        speed: 80,
                        deleteSpeed: 35,
                        pauseTime: 1500,
                    },
                },
                waves: {
                    enable: true,
                },
            },
        });
        expect(
            Object.prototype.hasOwnProperty.call(
                (banner.waves ?? {}) as Record<string, unknown>,
                "performanceMode",
            ),
        ).toBe(false);
    });
});

describe("site-settings home section layout", () => {
    it("先展示横幅文案，再展示轮播壁纸", () => {
        const bannerCopyIndex = siteHomeSectionSource.indexOf(
            "adminSiteSettingsBannerCopy",
        );
        const carouselIndex = siteHomeSectionSource.indexOf(
            "adminSiteSettingsCarouselWallpaper",
        );

        expect(bannerCopyIndex).toBeGreaterThanOrEqual(0);
        expect(carouselIndex).toBeGreaterThanOrEqual(0);
        expect(bannerCopyIndex).toBeLessThan(carouselIndex);
    });

    it("将图片上传、排序和视觉开关归入轮播壁纸分组", () => {
        const bannerCopyIndex = siteHomeSectionSource.indexOf(
            "adminSiteSettingsBannerCopy",
        );
        const carouselIndex = siteHomeSectionSource.indexOf(
            "adminSiteSettingsCarouselWallpaper",
        );
        const uploadIndex = siteHomeSectionSource.indexOf(
            "ss-banner-desktop-upload-btn",
        );
        const listIndex = siteHomeSectionSource.indexOf(
            "ss-banner-desktop-list",
        );
        const wavesIndex = siteHomeSectionSource.indexOf(
            "ss-banner-waves-enable",
        );

        expect(uploadIndex).toBeGreaterThan(carouselIndex);
        expect(listIndex).toBeGreaterThan(carouselIndex);
        expect(wavesIndex).toBeGreaterThan(carouselIndex);
        expect(uploadIndex).toBeGreaterThan(bannerCopyIndex);
    });

    it("不再渲染桌面壁纸标题或移动端壁纸字段", () => {
        expect(siteHomeSectionSource).not.toContain(
            "adminSiteSettingsDesktopWallpaper",
        );
        expect(siteHomeSectionSource).not.toMatch(
            /(?:mobile.*wallpaper|wallpaper.*mobile|ss-banner-mobile|banner-mobile|移动端壁纸)/iu,
        );
    });

    it("不再渲染优化波浪性能开关", () => {
        expect(siteHomeSectionSource).not.toContain(
            "ss-banner-waves-performance",
        );
        expect(siteHomeSectionSource).not.toContain(
            "adminSiteSettingsOptimizeWavePerformance",
        );
    });
});

describe("site-settings wallpaper i18n cleanup", () => {
    const adminTranslations = [zhCNAdmin, zhTWAdmin, enAdmin, jaAdmin];

    it("删除桌面壁纸 key 与翻译", () => {
        expect(Object.values(AdminKey)).not.toContain(
            "adminSiteSettingsDesktopWallpaper",
        );

        for (const translations of adminTranslations) {
            expect(translations).not.toHaveProperty(
                "adminSiteSettingsDesktopWallpaper",
            );
        }
    });

    it("使用横幅文案 key 与文案，并删除旧横幅图片与文案 key", () => {
        expect(Object.values(AdminKey)).toContain(
            "adminSiteSettingsBannerCopy",
        );
        expect(Object.values(AdminKey)).not.toContain(
            "adminSiteSettingsBannerImageAndCopy",
        );

        expect(zhCNAdmin.adminSiteSettingsBannerCopy).toBe("横幅文案");
        expect(zhTWAdmin.adminSiteSettingsBannerCopy).toBe("橫幅文案");
        expect(enAdmin.adminSiteSettingsBannerCopy).toBe("Banner copy");
        expect(jaAdmin.adminSiteSettingsBannerCopy).toBe("バナーコピー");

        for (const translations of adminTranslations) {
            expect(translations).not.toHaveProperty(
                "adminSiteSettingsBannerImageAndCopy",
            );
        }
    });

    it("不保留移动端壁纸类 key", () => {
        const keyPattern =
            /(?:mobile.*wallpaper|wallpaper.*mobile|MobileWallpaper|mobileWallpaper|移动端壁纸)/u;
        const translationPattern =
            /(?:mobile wallpaper|mobile.*wallpaper|wallpaper.*mobile|移动端壁纸|移動端桌布|モバイル.*壁紙)/iu;

        expect(
            Object.values(AdminKey).some((key) => keyPattern.test(key)),
        ).toBe(false);

        for (const translations of adminTranslations) {
            expect(
                Object.entries(translations).some(
                    ([key, value]) =>
                        keyPattern.test(key) || translationPattern.test(value),
                ),
            ).toBe(false);
        }
    });

    it("删除优化波浪性能 key 与翻译", () => {
        expect(Object.values(AdminKey)).not.toContain(
            "adminSiteSettingsOptimizeWavePerformance",
        );

        for (const translations of adminTranslations) {
            expect(translations).not.toHaveProperty(
                "adminSiteSettingsOptimizeWavePerformance",
            );
        }
    });
});

describe("site-settings wave runtime performance", () => {
    it("默认使用 transform 优化波浪动画，不再声明 fill 优化", () => {
        expect(mainGridCssSource).not.toContain("will-change: fill");
        expect(mainGridLayoutSource).not.toContain("will-change: fill");
        expect(mainGridCssSource).toContain("will-change: transform");
        expect(mainGridLayoutSource).toContain("will-change: transform");
    });
});
