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
    deleteFileReferencesForOwner: vi.fn().mockResolvedValue(0),
    bindFileOwnerToUser: vi.fn().mockResolvedValue(undefined),
    detachManagedFiles: vi.fn().mockResolvedValue([]),
    isSlugUniqueConflict: vi.fn().mockReturnValue(false),
    syncManagedFileBinding: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
}));

vi.mock("@/server/files/file-detach-jobs", () => ({
    enqueueFileDetachJob: vi.fn().mockResolvedValue({
        jobId: "detach-job-1",
        status: "pending",
        candidateFileIds: [],
    }),
}));

import {
    countItems,
    createOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { handleMeAlbumPhotos, handleMeAlbums } from "@/server/api/v1/me/albums";

const VALID_ALBUM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_PHOTO_ID = "22222222-3333-4444-8555-666666666666";
const MISSING_ALBUM_ID = "00000000-0000-4000-8000-000000000000";

type ErrorResponse = {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};

const mockedReadMany = vi.mocked(readMany);
const mockedReadOneById = vi.mocked(readOneById);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedCountItems = vi.mocked(countItems);
const mockedCreateOne = vi.mocked(createOne);

function createAlbum(overrides: Partial<AppAlbum> = {}): AppAlbum {
    return {
        id: VALID_ALBUM_ID,
        short_id: "CLalbum0001",
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
        id: VALID_PHOTO_ID,
        status: "published",
        album_id: VALID_ALBUM_ID,
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

describe("GET /me/albums/:id", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("非法相册 ID 返回 400 且不读取 Directus", async () => {
        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/albums/not-a-uuid",
        });
        const access = createMemberAccess();

        const response = await handleMeAlbums(
            ctx as unknown as APIContext,
            access,
            ["albums", "not-a-uuid"],
        );

        const body = await parseResponseJson<ErrorResponse>(response);
        expect(response.status).toBe(400);
        expect(body.error.code).toBe("ALBUM_ID_INVALID");
        expect(body.error.message).toBe("非法相册 ID");
        expect(mockedReadMany).not.toHaveBeenCalled();
        expect(mockedReadOneById).not.toHaveBeenCalled();
        expect(mockedUpdateOne).not.toHaveBeenCalled();
    });

    it("合法 UUID 但相册不存在时返回 404 且不外泄 Directus 403", async () => {
        mockedReadMany.mockResolvedValueOnce([] as never);
        const ctx = createMockAPIContext({
            method: "GET",
            url: `http://localhost:4321/api/v1/me/albums/${MISSING_ALBUM_ID}`,
        });
        const access = createMemberAccess();

        const response = await handleMeAlbums(
            ctx as unknown as APIContext,
            access,
            ["albums", MISSING_ALBUM_ID],
        );

        const body = await parseResponseJson<ErrorResponse>(response);
        expect(response.status).toBe(404);
        expect(body.error.code).toBe("ALBUM_NOT_FOUND");
        expect(body.error.message).toBe("相册不存在");
        expect(JSON.stringify(body)).not.toContain("DIRECTUS_FORBIDDEN");
        expect(mockedReadOneById).not.toHaveBeenCalled();
        expect(mockedUpdateOne).not.toHaveBeenCalled();
    });

    it("合法 UUID 详情先通过列表查询相册，找到后再读取照片", async () => {
        const album = createAlbum();
        const photo = createAlbumPhoto();
        mockedReadMany
            .mockResolvedValueOnce([album] as never)
            .mockResolvedValueOnce([photo] as never);
        const ctx = createMockAPIContext({
            method: "GET",
            url: `http://localhost:4321/api/v1/me/albums/${VALID_ALBUM_ID}`,
        });
        const access = createMemberAccess();

        const response = await handleMeAlbums(
            ctx as unknown as APIContext,
            access,
            ["albums", VALID_ALBUM_ID],
        );

        const body = await parseResponseJson<{
            ok: boolean;
            item: { id: string };
            photos: Array<{ id: string }>;
        }>(response);
        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.item.id).toBe(VALID_ALBUM_ID);
        expect(body.photos).toHaveLength(1);
        expect(mockedReadMany).toHaveBeenNthCalledWith(1, "app_albums", {
            filter: { id: { _eq: VALID_ALBUM_ID } },
            limit: 1,
        });
        expect(mockedReadMany).toHaveBeenNthCalledWith(2, "app_album_photos", {
            filter: { album_id: { _eq: VALID_ALBUM_ID } },
            sort: ["sort", "-date_created"],
            limit: 200,
        });
        expect(mockedReadOneById).not.toHaveBeenCalled();
    });
});

describe("PATCH /me/albums/:id", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("仅更新标题时不会隐式清空 tags", async () => {
        const album = createAlbum();
        mockedReadMany.mockResolvedValueOnce([album] as never);
        mockedUpdateOne.mockResolvedValue({
            ...album,
            title: "Updated Album",
        } as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: `http://localhost:4321/api/v1/me/albums/${VALID_ALBUM_ID}`,
            body: {
                title: "Updated Album",
            },
        });
        const access = createMemberAccess();

        const response = await handleMeAlbums(
            ctx as unknown as APIContext,
            access,
            ["albums", VALID_ALBUM_ID],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_albums",
            VALID_ALBUM_ID,
            {
                title: "Updated Album",
            },
        );

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
            url: `http://localhost:4321/api/v1/me/albums/${VALID_ALBUM_ID}/photos/${VALID_PHOTO_ID}`,
            body: {
                title: "Updated Photo",
            },
        });
        const access = createMemberAccess();

        const response = await handleMeAlbumPhotos(
            ctx as unknown as APIContext,
            access,
            ["albums", VALID_ALBUM_ID, "photos", VALID_PHOTO_ID],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_album_photos",
            VALID_PHOTO_ID,
            { title: "Updated Photo" },
        );

        const body = await parseResponseJson<{
            ok: boolean;
            item: { title: string };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.item.title).toBe("Updated Photo");
    });

    it("拒绝非法外链图片 URL 且不更新照片", async () => {
        const photo = createAlbumPhoto();
        const album = createAlbum();
        mockedReadOneById
            .mockResolvedValueOnce(photo as never)
            .mockResolvedValueOnce(album as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: `http://localhost:4321/api/v1/me/albums/${VALID_ALBUM_ID}/photos/${VALID_PHOTO_ID}`,
            body: {
                image_url: "not-a-url",
            },
        });
        const access = createMemberAccess();

        await expect(
            handleMeAlbumPhotos(ctx as unknown as APIContext, access, [
                "albums",
                VALID_ALBUM_ID,
                "photos",
                VALID_PHOTO_ID,
            ]),
        ).rejects.toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
            message: expect.stringContaining("图片链接仅支持 http/https 协议"),
        });
        expect(mockedUpdateOne).not.toHaveBeenCalled();
    });

    it("更新外链图片 URL 时会裁剪空白", async () => {
        const photo = createAlbumPhoto();
        const album = createAlbum();
        mockedReadOneById
            .mockResolvedValueOnce(photo as never)
            .mockResolvedValueOnce(album as never)
            .mockResolvedValueOnce(album as never);
        mockedUpdateOne.mockResolvedValue({
            ...photo,
            image_url: "https://example.com/photo.jpg",
        } as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: `http://localhost:4321/api/v1/me/albums/${VALID_ALBUM_ID}/photos/${VALID_PHOTO_ID}`,
            body: {
                image_url: " https://example.com/photo.jpg ",
            },
        });
        const access = createMemberAccess();

        const response = await handleMeAlbumPhotos(
            ctx as unknown as APIContext,
            access,
            ["albums", VALID_ALBUM_ID, "photos", VALID_PHOTO_ID],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_album_photos",
            VALID_PHOTO_ID,
            { image_url: "https://example.com/photo.jpg" },
        );
    });
});

describe("POST /me/albums/:albumId/photos", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("拒绝非法外链图片 URL 且不创建照片", async () => {
        mockedReadOneById.mockResolvedValueOnce(createAlbum() as never);
        mockedCountItems.mockResolvedValueOnce(0);

        const ctx = createMockAPIContext({
            method: "POST",
            url: `http://localhost:4321/api/v1/me/albums/${VALID_ALBUM_ID}/photos`,
            body: {
                image_url: "not-a-url",
            },
        });
        const access = createMemberAccess();

        await expect(
            handleMeAlbumPhotos(ctx as unknown as APIContext, access, [
                "albums",
                VALID_ALBUM_ID,
                "photos",
            ]),
        ).rejects.toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
            message: expect.stringContaining("图片链接仅支持 http/https 协议"),
        });
        expect(mockedCreateOne).not.toHaveBeenCalled();
    });

    it("创建外链图片时会裁剪空白", async () => {
        mockedReadOneById.mockResolvedValueOnce(createAlbum() as never);
        mockedCountItems.mockResolvedValueOnce(0);
        mockedCreateOne.mockResolvedValueOnce(
            createAlbumPhoto({
                image_url: "https://example.com/photo.jpg",
            }) as never,
        );

        const ctx = createMockAPIContext({
            method: "POST",
            url: `http://localhost:4321/api/v1/me/albums/${VALID_ALBUM_ID}/photos`,
            body: {
                image_url: " https://example.com/photo.jpg ",
            },
        });
        const access = createMemberAccess();

        const response = await handleMeAlbumPhotos(
            ctx as unknown as APIContext,
            access,
            ["albums", VALID_ALBUM_ID, "photos"],
        );

        expect(response.status).toBe(200);
        expect(mockedCreateOne).toHaveBeenCalledWith(
            "app_album_photos",
            expect.objectContaining({
                image_url: "https://example.com/photo.jpg",
            }),
        );
    });
});
