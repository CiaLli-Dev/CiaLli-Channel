import { describe, expect, it } from "vitest";

import {
    CreateAlbumPhotoSchema,
    CreateAlbumSchema,
    UpdateAlbumPhotoSchema,
    UpdateAlbumSchema,
} from "@/server/api/schemas/album";

describe("CreateAlbumSchema", () => {
    it("未提供 tags 时使用默认值 []", () => {
        const result = CreateAlbumSchema.parse({
            title: "Album",
        });

        expect(result.tags).toEqual([]);
    });

    it("会裁剪合法 cover_url 并拒绝非法 cover_url", () => {
        expect(
            CreateAlbumSchema.parse({
                title: "Album",
                cover_url: " https://example.com/cover.jpg ",
            }).cover_url,
        ).toBe("https://example.com/cover.jpg");

        expect(
            CreateAlbumSchema.safeParse({
                title: "Album",
                cover_url: "not-a-url",
            }).success,
        ).toBe(false);
    });
});

describe("UpdateAlbumSchema", () => {
    it("省略 tags 时不注入默认值", () => {
        const result = UpdateAlbumSchema.parse({
            title: "Updated Album",
        });

        expect(result.title).toBe("Updated Album");
        expect(result.tags).toBeUndefined();
    });

    it("允许清空 cover_url 并拒绝非法 cover_url", () => {
        expect(
            UpdateAlbumSchema.parse({ cover_url: null }).cover_url,
        ).toBeNull();
        expect(
            UpdateAlbumSchema.safeParse({
                cover_url: "data:image/png;base64,AAAA",
            }).success,
        ).toBe(false);
    });
});

describe("CreateAlbumPhotoSchema", () => {
    it("未提供 tags 时使用默认值 []", () => {
        const result = CreateAlbumPhotoSchema.parse({});

        expect(result.tags).toEqual([]);
    });

    it("会裁剪合法 image_url 并拒绝非法 image_url", () => {
        expect(
            CreateAlbumPhotoSchema.parse({
                image_url: " https://example.com/photo.jpg?size=large ",
            }).image_url,
        ).toBe("https://example.com/photo.jpg?size=large");

        expect(
            CreateAlbumPhotoSchema.safeParse({ image_url: "not-a-url" })
                .success,
        ).toBe(false);
    });
});

describe("UpdateAlbumPhotoSchema", () => {
    it("省略 tags 时不注入默认值", () => {
        const result = UpdateAlbumPhotoSchema.parse({
            title: "Updated Photo",
        });

        expect(result.title).toBe("Updated Photo");
        expect(result.tags).toBeUndefined();
    });

    it("允许清空 image_url 并拒绝非法 image_url", () => {
        expect(
            UpdateAlbumPhotoSchema.parse({ image_url: null }).image_url,
        ).toBeNull();
        expect(
            UpdateAlbumPhotoSchema.safeParse({ image_url: "/relative.jpg" })
                .success,
        ).toBe(false);
    });
});
