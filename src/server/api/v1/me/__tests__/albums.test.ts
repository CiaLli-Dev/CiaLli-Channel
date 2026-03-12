import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import type { AppAlbum, AppAlbumPhoto } from "@/types/app";

vi.mock("@/server/directus/client", () => ({
    countItems: vi.fn(),
    createOne: vi.fn(),
    deleteOne: vi.fn(),
    readMany: vi.fn(),
    readOneById: vi.fn(),
    updateOne: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        invalidate: vi.fn(),
        invalidateByDomain: vi.fn(),
    },
}));

vi.mock("@/server/cache/invalidation", () => ({
    awaitCacheInvalidations: vi
        .fn()
        .mockImplementation(async (tasks: Array<Promise<unknown>>) => {
            await Promise.all(tasks);
        }),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    cleanupOwnedOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
    collectAlbumFileIds: vi.fn().mockResolvedValue([]),
    normalizeDirectusFileId: vi.fn((value: unknown) =>
        typeof value === "string" ? value : null,
    ),
}));

vi.mock("@/server/api/v1/me/_helpers", () => ({
    bindFileOwnerToUser: vi.fn().mockResolvedValue(undefined),
    isSlugUniqueConflict: vi.fn().mockReturnValue(false),
}));

import { readOneById, updateOne } from "@/server/directus/client";
import { handleMeAlbumPhotos, handleMeAlbums } from "@/server/api/v1/me/albums";

const mockedReadOneById = vi.mocked(readOneById);
const mockedUpdateOne = vi.mocked(updateOne);

function createAlbum(overrides: Partial<AppAlbum> = {}): AppAlbum {
    return {
        id: "album-1",
        short_id: "album-1",
        author_id: "user-1",
        status: "published",
        title: "Album",
        slug: "album",
        description: null,
        cover_file: null,
        cover_url: null,
        date: null,
        location: null,
        tags: ["old-tag"],
        category: null,
        layout: "grid",
        columns: 3,
        is_public: true,
        date_created: null,
        date_updated: null,
        ...overrides,
    };
}

function createAlbumPhoto(
    overrides: Partial<AppAlbumPhoto> = {},
): AppAlbumPhoto {
    return {
        id: "photo-1",
        status: "published",
        album_id: "album-1",
        file_id: null,
        image_url: null,
        title: "Photo",
        description: null,
        tags: ["old-tag"],
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

describe("PATCH /me/albums/:id", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("仅更新标题时不会隐式清空 tags", async () => {
        const album = createAlbum();
        mockedReadOneById.mockResolvedValueOnce(album as never);
        mockedUpdateOne.mockResolvedValue({
            ...album,
            title: "Updated Album",
        } as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/albums/album-1",
            body: {
                title: "Updated Album",
            },
        });
        const access = createMemberAccess();

        const response = await handleMeAlbums(
            ctx as unknown as APIContext,
            access,
            ["albums", "album-1"],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith("app_albums", "album-1", {
            title: "Updated Album",
        });

        const body = await parseResponseJson<{
            ok: boolean;
            item: { title: string };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.item.title).toBe("Updated Album");
    });
});

describe("PATCH /me/albums/:albumId/photos/:photoId", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("仅更新标题时不会隐式清空 tags", async () => {
        const photo = createAlbumPhoto();
        const album = createAlbum();
        mockedReadOneById
            .mockResolvedValueOnce(photo as never)
            .mockResolvedValueOnce(album as never)
            .mockResolvedValueOnce(album as never);
        mockedUpdateOne.mockResolvedValue({
            ...photo,
            title: "Updated Photo",
        } as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/albums/album-1/photos/photo-1",
            body: {
                title: "Updated Photo",
            },
        });
        const access = createMemberAccess();

        const response = await handleMeAlbumPhotos(
            ctx as unknown as APIContext,
            access,
            ["albums", "album-1", "photos", "photo-1"],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_album_photos",
            "photo-1",
            { title: "Updated Photo" },
        );

        const body = await parseResponseJson<{
            ok: boolean;
            item: { title: string };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.item.title).toBe("Updated Photo");
    });
});
