import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import type { AppAlbum, AppAlbumPhoto } from "@/types/app";

const { getAuthorBundleMock, readAuthorMock } = vi.hoisted(() => ({
    getAuthorBundleMock: vi.fn(),
    readAuthorMock: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    countItems: vi.fn(),
    readMany: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: getAuthorBundleMock,
    readAuthor: readAuthorMock,
}));

import { readMany } from "@/server/directus/client";
import { cacheManager } from "@/server/cache/manager";
import { handlePublicAlbumsRoute } from "@/server/application/public/albums.service";

const mockedReadMany = vi.mocked(readMany);
const mockedCacheManager = vi.mocked(cacheManager);

const ALBUM_ID = "11111111-2222-4333-8444-555555555555";

type PublicAlbumDetailResponse = {
    ok: true;
    item: {
        cover_url: string | null;
        photos: Array<{ image_url: string | null }>;
    };
};

function createAlbum(overrides: Partial<AppAlbum> = {}): AppAlbum {
    return {
        id: ALBUM_ID,
        short_id: "CLalbum0001",
        author_id: "user-1",
        status: "published",
        title: "Album",
        slug: "album",
        description: null,
        cover_file: null,
        cover_url: "https://example.com/cover.jpg",
        date: null,
        location: null,
        tags: ["tag"],
        category: null,
        layout: "grid",
        columns: 3,
        is_public: true,
        date_created: null,
        date_updated: null,
        ...overrides,
    };
}

function createPhoto(overrides: Partial<AppAlbumPhoto> = {}): AppAlbumPhoto {
    return {
        id: "22222222-3333-4444-8555-666666666666",
        status: "published",
        album_id: ALBUM_ID,
        file_id: null,
        image_url: "https://example.com/photo.jpg",
        title: "Photo",
        description: null,
        tags: ["photo"],
        taken_at: null,
        location: null,
        is_public: true,
        show_on_profile: true,
        sort: null,
        date_created: null,
        date_updated: null,
        ...overrides,
    };
}

function createContext(): APIContext {
    return createMockAPIContext({
        method: "GET",
        url: `http://localhost:4321/api/v1/public/albums/${ALBUM_ID}`,
    }) as unknown as APIContext;
}

describe("handlePublicAlbumsRoute", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedCacheManager.get.mockResolvedValue(null);
        mockedCacheManager.set.mockResolvedValue(undefined);
        getAuthorBundleMock.mockResolvedValue(new Map());
        readAuthorMock.mockReturnValue({
            id: "user-1",
            name: "Alice",
            username: "alice",
        });
    });

    it("公开详情会过滤历史非法外链图片 URL", async () => {
        mockedReadMany
            .mockResolvedValueOnce([
                createAlbum({ cover_url: "not-a-url" }),
            ] as never)
            .mockResolvedValueOnce([
                createPhoto({ image_url: "not-a-url" }),
            ] as never);

        const response = await handlePublicAlbumsRoute(createContext(), [
            "public",
            "albums",
            ALBUM_ID,
        ]);
        const body =
            await parseResponseJson<PublicAlbumDetailResponse>(response);

        expect(response.status).toBe(200);
        expect(body.item.cover_url).toBeNull();
        expect(body.item.photos[0].image_url).toBeNull();
    });

    it("公开详情保留合法 http/https 外链图片 URL", async () => {
        mockedReadMany
            .mockResolvedValueOnce([createAlbum()] as never)
            .mockResolvedValueOnce([createPhoto()] as never);

        const response = await handlePublicAlbumsRoute(createContext(), [
            "public",
            "albums",
            ALBUM_ID,
        ]);
        const body =
            await parseResponseJson<PublicAlbumDetailResponse>(response);

        expect(response.status).toBe(200);
        expect(body.item.cover_url).toBe("https://example.com/cover.jpg");
        expect(body.item.photos[0].image_url).toBe(
            "https://example.com/photo.jpg",
        );
    });
});
