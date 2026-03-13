import type { AppAlbum, AppAlbumPhoto } from "@/types/app";
import { loadProfileByUsernameFromRepository } from "@/server/repositories/profile/profile.repository";
import {
    listUserAlbumsFromRepository,
    loadAlbumPhotosForAlbumFromRepository,
    loadOwnedAlbumByShortIdFromRepository,
} from "@/server/repositories/public/public-data.repository";
import { isShortId } from "@/server/utils/short-id";
import { loadPublicAlbumByShortId, safeCsv } from "./shared";
import type { AuthorBundleItem } from "./shared/author-cache";
import { getAuthorBundle } from "./shared/author-cache";
import { albumFilters, parsePaginationParams } from "./public-data-helpers";
import type {
    ContentLoadResult,
    PaginatedResult,
    ViewerOptions,
} from "./public-data-helpers";

export type UserAlbumListOptions = {
    page?: number;
    limit?: number;
};

export type AlbumDetail = AppAlbum & {
    tags: string[];
    author: AuthorBundleItem;
    photos: Array<AppAlbumPhoto & { tags: string[] }>;
};

export async function loadUserAlbumListHelper(
    username: string,
    options: UserAlbumListOptions & ViewerOptions,
    readAuthorFn: (
        authorMap: Map<string, AuthorBundleItem>,
        userId: string,
    ) => AuthorBundleItem,
): Promise<
    ContentLoadResult<
        PaginatedResult<AppAlbum & { tags: string[]; author: AuthorBundleItem }>
    >
> {
    const profile = await loadProfileByUsernameFromRepository(username);
    if (!profile) {
        return { status: "not_found" };
    }
    const isOwnerViewing =
        Boolean(options.viewerId) && options.viewerId === profile.user_id;
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }
    if (!isOwnerViewing && !profile.show_albums_on_profile) {
        return { status: "permission_denied", reason: "albums_not_public" };
    }
    const userId = profile.user_id;

    const { page, limit, offset } = parsePaginationParams(
        options.page,
        options.limit,
        100,
    );

    const [{ rows, total }, authorMap] = await Promise.all([
        listUserAlbumsFromRepository({
            userId,
            filters: albumFilters(isOwnerViewing),
            limit,
            offset,
        }),
        getAuthorBundle([userId]),
    ]);

    const items = rows.map((row) => ({
        ...row,
        tags: safeCsv(row.tags),
        author: readAuthorFn(authorMap, row.author_id),
    }));

    return { status: "ok", data: { items, page, limit, total } };
}

export async function loadUserAlbumDetailHelper(
    username: string,
    albumId: string,
    options: ViewerOptions | undefined,
    readAuthorFn: (
        authorMap: Map<string, AuthorBundleItem>,
        userId: string,
    ) => AuthorBundleItem,
): Promise<ContentLoadResult<AlbumDetail>> {
    const profile = await loadProfileByUsernameFromRepository(username);
    if (!profile) {
        return { status: "not_found" };
    }
    const isOwnerViewing =
        Boolean(options?.viewerId) && options?.viewerId === profile.user_id;
    if (!isOwnerViewing && !profile.profile_public) {
        return { status: "permission_denied", reason: "profile_not_public" };
    }
    if (!isOwnerViewing && !profile.show_albums_on_profile) {
        return { status: "permission_denied", reason: "albums_not_public" };
    }
    const userId = profile.user_id;

    if (!isShortId(albumId)) {
        return { status: "not_found" };
    }

    let album: AppAlbum | null;
    if (isOwnerViewing) {
        album = await loadOwnedAlbumByShortIdFromRepository(albumId);
    } else {
        album = await loadPublicAlbumByShortId(albumId);
    }
    if (!album || album.author_id !== userId) {
        return { status: "not_found" };
    }
    const [photos, authorMap] = await Promise.all([
        loadAlbumPhotosForAlbumFromRepository(album.id, isOwnerViewing),
        getAuthorBundle([userId]),
    ]);

    return {
        status: "ok",
        data: {
            ...album,
            tags: safeCsv(album.tags),
            author: readAuthorFn(authorMap, album.author_id),
            photos: photos.map((photo) => ({
                ...photo,
                tags: safeCsv(photo.tags),
            })),
        },
    };
}
