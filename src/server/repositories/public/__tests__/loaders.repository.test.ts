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

import { readMany } from "@/server/directus/client";
import {
    loadPublicArticleByIdFromRepository,
    loadPublicDiaryByIdFromRepository,
} from "@/server/repositories/public/loaders.repository";

const mockedReadMany = vi.mocked(readMany);

describe("public loaders repository", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("公开文章 UUID 查询前先校验 id 格式", async () => {
        const result =
            await loadPublicArticleByIdFromRepository("CLduXaJIir1w");

        expect(result).toBeNull();
        expect(mockedReadMany).not.toHaveBeenCalled();
    });

    it("公开日记 UUID 查询前先校验 id 格式，短 ID 不会打到 uuid 字段", async () => {
        const result = await loadPublicDiaryByIdFromRepository("CLduXaJIir1w");

        expect(result).toBeNull();
        expect(mockedReadMany).not.toHaveBeenCalled();
    });
});
