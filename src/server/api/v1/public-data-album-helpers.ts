import type { AppAlbum, AppAlbumPhoto, AppProfile } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { countItems, readMany } from "@/server/directus/client";
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

async function loadProfileByUsername(
    username: string,
): Promise<AppProfile | null> {
    const rows = await readMany("app_user_profiles", {
        filter: { username: { _eq: username } } as JsonObject,
        limit: 1,
    });
    return (rows[0] as AppProfile | undefined) ?? null;
}

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
    const profile = await loadProfileByUsername(username);
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

    const albumFilter = {
        _and: [...albumFilters(isOwnerViewing), { author_id: { _eq: userId } }],
    } as JsonObject;

    const [rows, total, authorMap] = await Promise.all([
        readMany("app_albums", {
            filter: albumFilter,
            sort: ["-date", "-date_created"],
            limit,
            offset,
        }),
        countItems("app_albums", albumFilter),
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
    const profile = await loadProfileByUsername(username);
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
        const rows = await readMany("app_albums", {
            filter: { short_id: { _eq: albumId } } as JsonObject,
            limit: 1,
        });
        album = (rows[0] as AppAlbum | undefined) ?? null;
    } else {
        album = await loadPublicAlbumByShortId(albumId);
    }
    if (!album || album.author_id !== userId) {
        return { status: "not_found" };
    }
    const photoFilters: JsonObject[] = [{ album_id: { _eq: album.id } }];
    if (!isOwnerViewing) {
        photoFilters.push(
            { status: { _eq: "published" } },
            { is_public: { _eq: true } },
        );
    }
    const [photos, authorMap] = await Promise.all([
        readMany("app_album_photos", {
            filter: { _and: photoFilters } as JsonObject,
            sort: ["sort", "-date_created"],
            limit: 200,
        }) as Promise<AppAlbumPhoto[]>,
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
