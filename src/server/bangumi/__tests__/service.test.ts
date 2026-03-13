import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: vi.fn(),
        set: vi.fn(),
        invalidate: vi.fn(),
        invalidateByDomain: vi.fn(),
    },
}));

vi.mock("@/server/bangumi/client", () => ({
    fetchBangumiCollectionsPage: vi.fn(),
    resolveBangumiApiUsernameById: vi.fn(async (input: string) => input),
}));

import {
    fetchBangumiCollectionsPage,
    resolveBangumiApiUsernameById,
} from "@/server/bangumi/client";
import { cacheManager } from "@/server/cache/manager";
import { loadBangumiCollections } from "@/server/bangumi/service";

const mockedFetchPage = vi.mocked(fetchBangumiCollectionsPage);
const mockedResolveBangumiApiUsernameById = vi.mocked(
    resolveBangumiApiUsernameById,
);
const mockedCacheGet = vi.mocked(cacheManager.get);
const mockedCacheSet = vi.mocked(cacheManager.set);

describe("loadBangumiCollections", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedCacheGet.mockResolvedValue(null);
        mockedCacheSet.mockResolvedValue(undefined);
        mockedResolveBangumiApiUsernameById.mockImplementation(
            async (input: string) => input,
        );
    });

    it("maps records and paginates merged data", async () => {
        mockedFetchPage.mockImplementation(async ({ type, offset }) => {
            if (offset > 0 || !type) {
                return { data: [], total: 1, limit: 100, offset };
            }
            return {
                data: [
                    {
                        subject_id: type,
                        type,
                        ep_status: type,
                        rate: type,
                        private: false,
                        updated_at: `2026-01-0${type}T00:00:00.000Z`,
                        tags: ["tag-local"],
                        subject: {
                            id: type,
                            name: `name-${type}`,
                            name_cn: `cn-${type}`,
                            short_summary: `summary-${type}`,
                            date: `202${type}-01-01`,
                            eps: 12,
                            score: 7 + type,
                            tags: [{ name: `tag-subject-${type}` }],
                            images: {
                                common: `https://img.example/${type}.jpg`,
                            },
                        },
                    },
                ],
                total: 1,
                limit: 100,
                offset,
            };
        });

        const result = await loadBangumiCollections({
            username: "914320",
            page: 1,
            limit: 2,
            includePrivate: false,
        });

        expect(result.total).toBe(5);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]?.watch_status).toBe("dropped");
        expect(result.items[0]?.title).toBe("cn-5");
        expect(result.items[0]?.genres).toContain("tag-local");
        expect(result.items[0]?.genres).toContain("tag-subject-5");
    });

    it("fetches only selected status type", async () => {
        mockedFetchPage.mockResolvedValue({
            data: [],
            total: 0,
            limit: 100,
            offset: 0,
        });

        await loadBangumiCollections({
            username: "914320",
            page: 1,
            limit: 20,
            status: "watching",
            includePrivate: false,
        });

        expect(mockedFetchPage).toHaveBeenCalledTimes(1);
        expect(mockedFetchPage.mock.calls[0]?.[0].type).toBe(3);
    });

    it("falls back to public when private fetch fails", async () => {
        mockedFetchPage.mockImplementation(async ({ accessToken, offset }) => {
            if (offset > 0) {
                return { data: [], total: 0, limit: 100, offset };
            }
            if (accessToken) {
                throw new Error("private fetch failed");
            }
            return {
                data: [],
                total: 0,
                limit: 100,
                offset,
            };
        });

        const result = await loadBangumiCollections({
            username: "914320",
            page: 1,
            limit: 20,
            includePrivate: true,
            accessToken: "bgm_pat_secret",
        });

        expect(result.total).toBe(0);
        const calledWithToken = mockedFetchPage.mock.calls.some(
            ([arg]) => arg.accessToken === "bgm_pat_secret",
        );
        const calledWithoutToken = mockedFetchPage.mock.calls.some(
            ([arg]) => !arg.accessToken,
        );
        expect(calledWithToken).toBe(true);
        expect(calledWithoutToken).toBe(true);

        const cacheKey = String(mockedCacheSet.mock.calls[0]?.[1] || "");
        expect(cacheKey).not.toContain("bgm_pat_secret");
    });

    it("resolves uid to api username before fetching", async () => {
        mockedFetchPage.mockResolvedValue({
            data: [],
            total: 0,
            limit: 50,
            offset: 0,
        });
        mockedResolveBangumiApiUsernameById.mockResolvedValue("sai");

        await loadBangumiCollections({
            username: "1",
            page: 1,
            limit: 20,
            includePrivate: false,
        });

        expect(mockedResolveBangumiApiUsernameById).toHaveBeenCalledWith("1");
        expect(mockedFetchPage).toHaveBeenCalled();
        expect(mockedFetchPage.mock.calls[0]?.[0].username).toBe("sai");
    });

    it("returns empty result when bangumi id is invalid", async () => {
        const result = await loadBangumiCollections({
            username: "https://bangumi.tv/user/914320",
            page: 1,
            limit: 20,
            includePrivate: false,
        });

        expect(result.total).toBe(0);
        expect(result.items).toEqual([]);
        expect(mockedFetchPage).not.toHaveBeenCalled();
    });

    it("uses official max page size 50 when requesting api", async () => {
        mockedFetchPage.mockResolvedValue({
            data: [],
            total: 0,
            limit: 50,
            offset: 0,
        });

        await loadBangumiCollections({
            username: "914320",
            page: 1,
            limit: 20,
            includePrivate: false,
        });

        expect(mockedFetchPage.mock.calls[0]?.[0].limit).toBe(50);
    });
});
