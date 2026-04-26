import { normalizeExternalImageUrl } from "@/utils/external-image-policy";

export function normalizeAlbumCoverUrl<T extends { cover_url: string | null }>(
    album: T,
): T {
    return {
        ...album,
        cover_url: normalizeExternalImageUrl(album.cover_url),
    };
}

export function normalizeAlbumPhotoImageUrl<
    T extends { image_url: string | null },
>(photo: T): T {
    return {
        ...photo,
        image_url: normalizeExternalImageUrl(photo.image_url),
    };
}

export function normalizeAlbumPhotoImageUrls<
    T extends { image_url: string | null },
>(photos: T[]): T[] {
    return photos.map((photo) => normalizeAlbumPhotoImageUrl(photo));
}
