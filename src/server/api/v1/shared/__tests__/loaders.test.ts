import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/directus/client", () => ({
    readMany: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

import {
    ARTICLE_FIELDS,
    FRIEND_FIELDS,
} from "@/server/api/v1/shared/constants";
import {
    loadPublicArticleBySlug,
    loadPublicFriends,
} from "@/server/api/v1/shared/loaders";
import { cacheManager } from "@/server/cache/manager";
import { readMany } from "@/server/directus/client";

const mockedReadMany = vi.mocked(readMany);
const mockedCacheManager = vi.mocked(cacheManager);

describe("shared loaders field whitelists", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedCacheManager.get.mockResolvedValue(null);
        mockedCacheManager.set.mockResolvedValue(undefined);
        mockedReadMany.mockResolvedValue([]);
    });

    it("loadPublicArticleBySlug uses explicit article fields", async () => {
        await loadPublicArticleBySlug("about");

        expect(mockedReadMany).toHaveBeenCalledWith(
            "app_articles",
            expect.objectContaining({
                fields: [...ARTICLE_FIELDS],
                limit: 1,
            }),
        );
    });

    it("loadPublicFriends uses explicit friend fields", async () => {
        await loadPublicFriends();

        expect(mockedReadMany).toHaveBeenCalledWith(
            "app_friends",
            expect.objectContaining({
                fields: [...FRIEND_FIELDS],
                limit: 500,
            }),
        );
    });
});
