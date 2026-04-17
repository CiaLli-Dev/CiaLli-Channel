import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

const { getSessionAccessTokenMock, getSessionUserMock } = vi.hoisted(() => ({
    getSessionAccessTokenMock: vi.fn().mockReturnValue("token"),
    getSessionUserMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/server/auth/session", () => ({
    getSessionAccessToken: getSessionAccessTokenMock,
    getSessionUser: getSessionUserMock,
}));

vi.mock("@/server/api/v1/public-data", () => ({
    loadUserHomeData: vi.fn(),
    loadUserBangumiList: vi.fn(),
    loadUserDiaryList: vi.fn(),
    loadUserDiaryDetail: vi.fn(),
    loadUserAlbumList: vi.fn(),
    loadUserAlbumDetail: vi.fn(),
}));

import {
    loadUserBangumiList,
    loadUserDiaryList,
    loadUserHomeData,
    loadUserAlbumList,
} from "@/server/api/v1/public-data";
import { handleUserHome } from "@/server/api/v1/public/user-home";

const mockedLoadUserHomeData = vi.mocked(loadUserHomeData);
const mockedLoadUserBangumiList = vi.mocked(loadUserBangumiList);
const mockedLoadUserDiaryList = vi.mocked(loadUserDiaryList);
const mockedLoadUserAlbumList = vi.mocked(loadUserAlbumList);

describe("handleUserHome route modules", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSessionAccessTokenMock.mockReturnValue("token");
        getSessionUserMock.mockResolvedValue(null);
    });

    it("/users/:username/bangumi returns data", async () => {
        mockedLoadUserBangumiList.mockResolvedValue({
            status: "ok",
            data: {
                items: [],
                page: 1,
                limit: 20,
                total: 0,
            },
        });

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/users/alice/bangumi",
            params: { segments: "users/alice/bangumi" },
        });

        const response = await handleUserHome(ctx as unknown as APIContext, [
            "users",
            "alice",
            "bangumi",
        ]);

        expect(response.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            items: unknown[];
            total: number;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.items).toEqual([]);
        expect(body.total).toBe(0);
    });

    it("/users/:username/anime is removed and returns 404", async () => {
        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/users/alice/anime",
            params: { segments: "users/alice/anime" },
        });

        const response = await handleUserHome(ctx as unknown as APIContext, [
            "users",
            "alice",
            "anime",
        ]);

        expect(response.status).toBe(404);
        expect(mockedLoadUserBangumiList).not.toHaveBeenCalled();
    });

    it("/users/:username/home keeps bangumi field in payload", async () => {
        mockedLoadUserHomeData.mockResolvedValue({
            status: "ok",
            data: {
                profile: {
                    id: "profile-1",
                    user_id: "user-1",
                    username: "alice",
                    display_name: "Alice",
                    bio: null,
                    avatar_file: null,
                    header_file: null,
                    profile_public: true,
                    show_articles_on_profile: true,
                    show_diaries_on_profile: true,
                    show_bangumi_on_profile: true,
                    show_albums_on_profile: true,
                    show_comments_on_profile: true,
                    bangumi_username: "914320",
                    bangumi_include_private: false,
                    social_links: null,
                    home_section_order: [
                        "articles",
                        "diaries",
                        "bangumi",
                        "albums",
                    ],
                    is_official: false,
                    status: "published",
                },
                owner: {
                    id: "user-1",
                    name: "Alice",
                    username: "alice",
                },
                articles: [],
                diaries: [],
                bangumi: [],
                albums: [],
            },
        });

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/users/alice/home",
            params: { segments: "users/alice/home" },
        });

        const response = await handleUserHome(ctx as unknown as APIContext, [
            "users",
            "alice",
            "home",
        ]);

        expect(response.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            bangumi: unknown[];
        }>(response);
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.bangumi)).toBe(true);
    });

    it("带登录态访问 /users/:username/home 仍走公共 snapshot 并返回公共缓存头", async () => {
        getSessionUserMock.mockResolvedValue({
            id: "viewer-1",
        });
        mockedLoadUserHomeData.mockResolvedValue({
            status: "ok",
            data: {
                profile: {
                    id: "profile-1",
                    user_id: "user-1",
                    username: "alice",
                    display_name: "Alice",
                    bio: null,
                    avatar_file: null,
                    header_file: null,
                    profile_public: true,
                    show_articles_on_profile: true,
                    show_diaries_on_profile: true,
                    show_bangumi_on_profile: true,
                    show_albums_on_profile: true,
                    show_comments_on_profile: true,
                    bangumi_username: null,
                    bangumi_include_private: false,
                    social_links: null,
                    home_section_order: null,
                    is_official: false,
                    status: "published",
                },
                owner: {
                    id: "user-1",
                    name: "Alice",
                    username: "alice",
                },
                articles: [],
                diaries: [],
                bangumi: [],
                albums: [],
            },
        });

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/users/alice/home",
            params: { segments: "users/alice/home" },
            cookies: {
                directus_access_token: "token",
            },
        });

        const response = await handleUserHome(ctx as unknown as APIContext, [
            "users",
            "alice",
            "home",
        ]);

        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe(
            "public, s-maxage=60, stale-while-revalidate=300",
        );
        expect(mockedLoadUserHomeData).toHaveBeenCalledWith("alice");
        expect(getSessionUserMock).not.toHaveBeenCalled();
    });

    it("带登录态访问 /users/:username/bangumi 仍走公共 snapshot", async () => {
        getSessionUserMock.mockResolvedValue({
            id: "viewer-1",
        });
        mockedLoadUserBangumiList.mockResolvedValue({
            status: "ok",
            data: {
                items: [],
                page: 1,
                limit: 20,
                total: 0,
            },
        });

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/users/alice/bangumi",
            params: { segments: "users/alice/bangumi" },
            cookies: {
                directus_access_token: "token",
            },
        });

        const response = await handleUserHome(ctx as unknown as APIContext, [
            "users",
            "alice",
            "bangumi",
        ]);

        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe(
            "public, s-maxage=60, stale-while-revalidate=300",
        );
        expect(mockedLoadUserBangumiList).toHaveBeenCalledWith("alice", {
            page: 1,
            limit: 20,
            status: undefined,
        });
        expect(getSessionUserMock).not.toHaveBeenCalled();
    });

    it("带登录态访问 /users/:username/diary 列表仍走公共 snapshot", async () => {
        getSessionUserMock.mockResolvedValue({
            id: "viewer-1",
        });
        mockedLoadUserDiaryList.mockResolvedValue({
            status: "ok",
            data: {
                items: [],
                page: 1,
                limit: 20,
                total: 0,
            },
        });

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/users/alice/diary",
            params: { segments: "users/alice/diary" },
            cookies: {
                directus_access_token: "token",
            },
        });

        const response = await handleUserHome(ctx as unknown as APIContext, [
            "users",
            "alice",
            "diary",
        ]);

        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe(
            "public, s-maxage=60, stale-while-revalidate=300",
        );
        expect(mockedLoadUserDiaryList).toHaveBeenCalledWith("alice", {
            page: 1,
            limit: 20,
        });
        expect(getSessionUserMock).not.toHaveBeenCalled();
    });

    it("带登录态访问 /users/:username/albums 列表仍走公共 snapshot", async () => {
        getSessionUserMock.mockResolvedValue({
            id: "viewer-1",
        });
        mockedLoadUserAlbumList.mockResolvedValue({
            status: "ok",
            data: {
                items: [],
                page: 1,
                limit: 20,
                total: 0,
            },
        });

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/users/alice/albums",
            params: { segments: "users/alice/albums" },
            cookies: {
                directus_access_token: "token",
            },
        });

        const response = await handleUserHome(ctx as unknown as APIContext, [
            "users",
            "alice",
            "albums",
        ]);

        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe(
            "public, s-maxage=60, stale-while-revalidate=300",
        );
        expect(mockedLoadUserAlbumList).toHaveBeenCalledWith("alice", {
            page: 1,
            limit: 20,
        });
        expect(getSessionUserMock).not.toHaveBeenCalled();
    });

    it("/users/:username/bangumi permission_denied -> 404", async () => {
        mockedLoadUserBangumiList.mockResolvedValue({
            status: "permission_denied",
            reason: "bangumi_not_public",
        });

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/users/alice/bangumi",
            params: { segments: "users/alice/bangumi" },
        });

        const response = await handleUserHome(ctx as unknown as APIContext, [
            "users",
            "alice",
            "bangumi",
        ]);

        expect(response.status).toBe(404);
    });
});
