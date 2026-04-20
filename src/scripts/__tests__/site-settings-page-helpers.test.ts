import { beforeEach, describe, expect, it, vi } from "vitest";

const setValMock = vi.fn();
const setSelectMock = vi.fn();
const setCheckedMock = vi.fn();
const inputValMock = vi.fn((id: string) => inputState[id] ?? "");
const textareaValMock = vi.fn((_id: string) => "");
const checkedMock = vi.fn((_id: string) => false);
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
    collectSitePayload,
} from "@/scripts/site-settings/page-helpers";

describe("site-settings page helpers theme preset", () => {
    beforeEach(() => {
        inputState = {};
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
});
