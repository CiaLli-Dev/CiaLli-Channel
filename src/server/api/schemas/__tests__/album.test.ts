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
});

describe("UpdateAlbumSchema", () => {
    it("省略 tags 时不注入默认值", () => {
        const result = UpdateAlbumSchema.parse({
            title: "Updated Album",
        });

        expect(result.title).toBe("Updated Album");
        expect(result.tags).toBeUndefined();
    });
});

describe("CreateAlbumPhotoSchema", () => {
    it("未提供 tags 时使用默认值 []", () => {
        const result = CreateAlbumPhotoSchema.parse({});

        expect(result.tags).toEqual([]);
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
});
