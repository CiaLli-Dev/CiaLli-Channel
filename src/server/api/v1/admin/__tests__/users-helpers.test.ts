import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JsonObject } from "@/types/json";

vi.mock("@/server/repositories/files/file-metadata.repository", () => ({
    loadReferencedFilesByUserFromRepository: vi.fn(),
    updateItemsByFilter: vi.fn(),
    updateManagedFileMetadata: vi.fn(),
    updateRegistrationRequestAvatar: vi.fn(),
}));

import {
    loadReferencedFilesByUserFromRepository,
    updateItemsByFilter,
} from "@/server/repositories/files/file-metadata.repository";
import {
    clearBlockingUserReferences,
    loadReferencedFilesByUser,
} from "@/server/api/v1/admin/users-helpers";

const mockedUpdateItemsByFilter = vi.mocked(updateItemsByFilter);
const mockedLoadReferencedFilesByUserFromRepository = vi.mocked(
    loadReferencedFilesByUserFromRepository,
);

describe("admin users helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("跳过可选集合的 Directus forbidden 清理错误", async () => {
        mockedUpdateItemsByFilter.mockImplementation(
            async (params: {
                collection: string;
                filter: JsonObject;
                data: JsonObject;
            }) => {
                if (params.collection === "ai_prompts") {
                    throw new Error(
                        '[directus/client] 读取集合 ai_prompts 批量更新候选失败 (403) codes=FORBIDDEN: FORBIDDEN:You don\'t have permission to access collection "ai_prompts" or it does not exist.',
                    );
                }
            },
        );

        await expect(
            clearBlockingUserReferences("user-1"),
        ).resolves.toBeUndefined();
        expect(mockedUpdateItemsByFilter).toHaveBeenCalledWith({
            collection: "ai_prompts",
            filter: { user_created: { _eq: "user-1" } },
            data: { user_created: null },
        });
    });

    it("非可选集合的 Directus forbidden 清理错误仍向上抛出", async () => {
        mockedUpdateItemsByFilter.mockImplementation(
            async (params: {
                collection: string;
                filter: JsonObject;
                data: JsonObject;
            }) => {
                if (params.collection === "directus_versions") {
                    throw new Error("DIRECTUS_FORBIDDEN");
                }
            },
        );

        await expect(clearBlockingUserReferences("user-1")).rejects.toThrow(
            "DIRECTUS_FORBIDDEN",
        );
    });

    it("读取用户引用文件遇到权限错误时返回空数组", async () => {
        mockedLoadReferencedFilesByUserFromRepository.mockRejectedValueOnce(
            new Error("DIRECTUS_FORBIDDEN"),
        );

        await expect(loadReferencedFilesByUser("user-1")).resolves.toEqual([]);
    });
});
