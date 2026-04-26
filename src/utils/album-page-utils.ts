import {
    buildDirectusAssetUrl,
    buildPublicAssetUrl,
} from "@/server/directus-auth";
import { resolveAuthorIdentity } from "@/utils/author-identity";
import {
    ALBUM_MASONRY_WIDTH,
    ALBUM_GRID_WIDTH,
    ALBUM_GRID_HEIGHT,
} from "@/constants/image";
import { normalizeExternalImageUrl } from "@/utils/external-image-policy";

export function resolveAlbumCoverUrl(
    item: {
        cover_file: string | null;
        cover_url: string | null;
        layout: "grid" | "masonry";
    },
    privateAccess = false,
): string | null {
    const coverUrl = normalizeExternalImageUrl(item.cover_url);
    if (coverUrl) {
        return coverUrl;
    }
    if (item.cover_file) {
        const buildAssetUrl = privateAccess
            ? buildDirectusAssetUrl
            : buildPublicAssetUrl;
        if (item.layout === "masonry") {
            return buildAssetUrl(item.cover_file, { width: 960 });
        }
        return buildAssetUrl(item.cover_file, {
            width: 960,
            height: 640,
            fit: "cover",
        });
    }
    return null;
}

export function formatAlbumDate(value: string | null | undefined): string {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return raw;
    }
    return `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}`;
}

export function buildGoogleMapsSearchUrl(
    value: string | null | undefined,
): string {
    const query = String(value || "").trim();
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function resolveAlbumAuthor(item: {
    author_id: string;
    author?: {
        id?: string;
        name?: string;
        display_name?: string;
        username?: string;
    };
}): { displayName: string; username: string; handle: string } {
    const authorIdentity = resolveAuthorIdentity(
        {
            id: item.author?.id,
            name: item.author?.name,
            display_name: item.author?.display_name,
            username: item.author?.username,
        },
        item.author_id,
    );
    const handle = String(authorIdentity.username || item.author_id || "")
        .trim()
        .replace(/^@+/, "");
    return { ...authorIdentity, handle };
}

export function resolvePhotoUrl(
    photo: { file_id: string | null; image_url: string | null },
    layout: "grid" | "masonry",
    privateAccess = false,
): string | null {
    const imageUrl = normalizeExternalImageUrl(photo.image_url);
    if (imageUrl) {
        return imageUrl;
    }
    if (photo.file_id) {
        const buildAssetUrl = privateAccess
            ? buildDirectusAssetUrl
            : buildPublicAssetUrl;
        if (layout === "masonry") {
            return buildAssetUrl(photo.file_id, {
                width: ALBUM_MASONRY_WIDTH,
            });
        }
        return buildAssetUrl(photo.file_id, {
            width: ALBUM_GRID_WIDTH,
            height: ALBUM_GRID_HEIGHT,
            fit: "cover",
        });
    }
    return null;
}

export function resolvePhotoPreviewUrl(
    photo: {
        file_id: string | null;
        image_url: string | null;
    },
    privateAccess = false,
): string | null {
    const imageUrl = normalizeExternalImageUrl(photo.image_url);
    if (imageUrl) {
        return imageUrl;
    }
    if (photo.file_id) {
        const buildAssetUrl = privateAccess
            ? buildDirectusAssetUrl
            : buildPublicAssetUrl;
        return buildAssetUrl(photo.file_id, {
            width: ALBUM_MASONRY_WIDTH,
        });
    }
    return null;
}
