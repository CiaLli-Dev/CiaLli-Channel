import { beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGetMock, cacheSetMock } = vi.hoisted(() => ({
    cacheGetMock: vi.fn(),
    cacheSetMock: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: cacheGetMock,
        set: cacheSetMock,
    },
}));

import { getBannerImages } from "@/utils/main-grid-layout-utils";

describe("getBannerImages", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cacheGetMock.mockResolvedValue(null);
        cacheSetMock.mockResolvedValue(undefined);
    });

    it("优先返回站点设置内的 banner.src，不等待外部图片 API", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            text: vi
                .fn()
                .mockResolvedValue("https://example.com/api-banner.jpg"),
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await getBannerImages({
            banner: {
                src: ["/local-banner.jpg"],
                imageApi: {
                    enable: true,
                    url: "https://example.com/banner-api",
                },
            },
        } as never);

        expect(result).toEqual(["/local-banner.jpg"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it("未配置本地 banner 时回退到缓存的外部 banner 列表", async () => {
        cacheGetMock.mockResolvedValue([
            "https://example.com/cached-banner.jpg",
        ]);
        const fetchMock = vi.fn().mockResolvedValue({
            text: vi
                .fn()
                .mockResolvedValue("https://example.com/api-banner.jpg"),
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await getBannerImages({
            banner: {
                src: [],
                imageApi: {
                    enable: true,
                    url: "https://example.com/banner-api",
                },
            },
        } as never);

        expect(result).toEqual(["https://example.com/cached-banner.jpg"]);
        expect(cacheGetMock).toHaveBeenCalledWith("banner-images", "default");
        vi.unstubAllGlobals();
    });
});
