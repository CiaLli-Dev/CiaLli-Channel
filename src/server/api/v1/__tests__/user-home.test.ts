import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/auth/session", () => ({
    getSessionUser: vi.fn().mockResolvedValue(null),
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
    loadUserHomeData,
} from "@/server/api/v1/public-data";
import { handleUserHome } from "@/server/api/v1/public/user-home";

const mockedLoadUserHomeData = vi.mocked(loadUserHomeData);
const mockedLoadUserBangumiList = vi.mocked(loadUserBangumiList);

describe("handleUserHome route modules", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
