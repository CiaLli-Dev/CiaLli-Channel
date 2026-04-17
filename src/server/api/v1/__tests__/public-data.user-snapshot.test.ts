import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockProfile, mockProfileView } from "@/__tests__/helpers/mock-data";

const {
    getAuthorBundleMock,
    loadBangumiCollectionsMock,
    loadProfileByUsernameFromRepositoryMock,
    loadProfileViewByUsernameFromRepositoryMock,
} = vi.hoisted(() => ({
    getAuthorBundleMock: vi.fn(),
    loadBangumiCollectionsMock: vi.fn(),
    loadProfileByUsernameFromRepositoryMock: vi.fn(),
    loadProfileViewByUsernameFromRepositoryMock: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: getAuthorBundleMock,
}));

vi.mock("@/server/bangumi/service", () => ({
    loadBangumiCollections: loadBangumiCollectionsMock,
}));

vi.mock("@/server/bangumi/token", () => ({
    decryptBangumiAccessToken: vi.fn().mockReturnValue(null),
}));

vi.mock("@/server/directus-auth", () => ({
    buildPublicAssetUrl: vi.fn((id: string) => `/api/v1/public/assets/${id}`),
}));

vi.mock("@/server/repositories/profile/profile.repository", () => ({
    loadProfileByUsernameFromRepository:
        loadProfileByUsernameFromRepositoryMock,
}));

vi.mock("@/server/repositories/public/public-data.repository", () => ({
    fetchDiaryCommentCountMapFromRepository: vi
        .fn()
        .mockResolvedValue(new Map()),
    fetchDiaryLikeCountMapFromRepository: vi.fn().mockResolvedValue(new Map()),
    listHomeAlbumsFromRepository: vi.fn().mockResolvedValue([]),
    listHomeArticlesFromRepository: vi.fn().mockResolvedValue([]),
    listHomeDiariesFromRepository: vi.fn().mockResolvedValue([]),
    listUserAlbumsFromRepository: vi.fn().mockResolvedValue({
        rows: [],
        total: 0,
    }),
    listUserDiariesFromRepository: vi.fn().mockResolvedValue({
        rows: [],
        total: 0,
    }),
    loadAdministratorSidebarFallbackSourceFromRepository: vi
        .fn()
        .mockResolvedValue(null),
    loadAlbumPhotosForAlbumFromRepository: vi.fn().mockResolvedValue([]),
    loadDiaryImagesForDiaryFromRepository: vi.fn().mockResolvedValue([]),
    loadDiaryImagesForIdsFromRepository: vi.fn().mockResolvedValue([]),
    loadOwnedAlbumByShortIdFromRepository: vi.fn().mockResolvedValue(null),
    loadOwnedDiaryByShortIdFromRepository: vi.fn().mockResolvedValue(null),
    loadProfileViewByFilterFromRepository: vi.fn().mockResolvedValue(null),
    loadProfileViewByUsernameFromRepository:
        loadProfileViewByUsernameFromRepositoryMock,
}));

import {
    loadUserAlbumList,
    loadUserBangumiList,
    loadUserDiaryList,
    loadUserHomeData,
} from "@/server/api/v1/public-data";

describe("public-data user snapshot loaders", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAuthorBundleMock.mockResolvedValue(
            new Map([
                [
                    "user-1",
                    {
                        id: "user-1",
                        name: "Alice",
                        username: "alice",
                    },
                ],
            ]),
        );
        loadBangumiCollectionsMock.mockResolvedValue({
            items: [],
            page: 1,
            limit: 20,
            total: 0,
        });
        loadProfileByUsernameFromRepositoryMock.mockResolvedValue(
            mockProfile({
                username: "alice",
                user_id: "user-1",
            }),
        );
        loadProfileViewByUsernameFromRepositoryMock.mockResolvedValue(
            mockProfileView({
                username: "alice",
                user_id: "user-1",
            }),
        );
    });

    it("用户主页 snapshot 对 profile_public=false 返回 permission_denied", async () => {
        loadProfileViewByUsernameFromRepositoryMock.mockResolvedValue(
            mockProfileView({
                username: "alice",
                user_id: "user-1",
                profile_public: false,
            }),
        );

        await expect(loadUserHomeData("alice")).resolves.toEqual({
            status: "permission_denied",
            reason: "profile_not_public",
        });
    });

    it("用户主页 snapshot 不补隐藏分区", async () => {
        loadProfileViewByUsernameFromRepositoryMock.mockResolvedValue(
            mockProfileView({
                username: "alice",
                user_id: "user-1",
                show_articles_on_profile: false,
                show_diaries_on_profile: false,
                show_bangumi_on_profile: false,
                show_albums_on_profile: false,
            }),
        );

        const result = await loadUserHomeData("alice");

        expect(result.status).toBe("ok");
        if (result.status !== "ok") {
            return;
        }

        expect(result.data.articles).toEqual([]);
        expect(result.data.diaries).toEqual([]);
        expect(result.data.bangumi).toEqual([]);
        expect(result.data.albums).toEqual([]);
        expect(loadBangumiCollectionsMock).not.toHaveBeenCalled();
    });

    it("Bangumi 列表 snapshot 对隐藏模块返回 permission_denied", async () => {
        loadProfileViewByUsernameFromRepositoryMock.mockResolvedValue(
            mockProfileView({
                username: "alice",
                user_id: "user-1",
                show_bangumi_on_profile: false,
            }),
        );

        await expect(loadUserBangumiList("alice")).resolves.toEqual({
            status: "permission_denied",
            reason: "bangumi_not_public",
        });
    });

    it("日记列表 snapshot 对隐藏模块返回 permission_denied", async () => {
        loadProfileViewByUsernameFromRepositoryMock.mockResolvedValue(
            mockProfileView({
                username: "alice",
                user_id: "user-1",
                show_diaries_on_profile: false,
            }),
        );

        await expect(loadUserDiaryList("alice")).resolves.toEqual({
            status: "permission_denied",
            reason: "diaries_not_public",
        });
    });

    it("相册列表 snapshot 对隐藏模块返回 permission_denied", async () => {
        loadProfileByUsernameFromRepositoryMock.mockResolvedValue(
            mockProfile({
                username: "alice",
                user_id: "user-1",
                show_albums_on_profile: false,
            }),
        );

        await expect(loadUserAlbumList("alice")).resolves.toEqual({
            status: "permission_denied",
            reason: "albums_not_public",
        });
    });
});
