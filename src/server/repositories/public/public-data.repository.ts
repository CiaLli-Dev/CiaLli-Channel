import type {
    AppAlbum,
    AppAlbumPhoto,
    AppArticle,
    AppDiary,
    AppDiaryImage,
    AppProfile,
    AppProfileView,
    AppUser,
} from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    countItems,
    countItemsGroupedByField,
    listDirectusRoles,
    readMany,
} from "@/server/directus/client";
import { isPlatformAdministratorRoleName } from "@/server/auth/directus-access";
import { toAppProfileView } from "@/server/profile-view";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";

import { DIARY_FIELDS } from "@/server/api/v1/shared/constants";

export type AdministratorSidebarFallbackSource = {
    profile: AppProfileView;
};

export async function loadProfileViewByUsernameFromRepository(
    username: string,
): Promise<AppProfileView | null> {
    const rows = (await readMany("app_user_profiles", {
        filter: { username: { _eq: username } } as JsonObject,
        limit: 1,
    })) as AppProfile[];
    const profile = rows[0];
    if (!profile) {
        return null;
    }
    const users = await withServiceRepositoryContext(
        async () =>
            await readMany("directus_users", {
                filter: { id: { _eq: profile.user_id } } as JsonObject,
                limit: 1,
                fields: [
                    "id",
                    "email",
                    "first_name",
                    "last_name",
                    "avatar",
                    "description",
                ],
            }).catch(() => []),
    );
    return toAppProfileView(profile, users[0]);
}

export async function loadProfileViewByFilterFromRepository(
    filter: JsonObject,
): Promise<AppProfileView | null> {
    const rows = (await readMany("app_user_profiles", {
        filter,
        limit: 1,
    })) as AppProfile[];
    const profile = rows[0];
    if (!profile) {
        return null;
    }
    const users = await withServiceRepositoryContext(
        async () =>
            await readMany("directus_users", {
                filter: { id: { _eq: profile.user_id } } as JsonObject,
                limit: 1,
                fields: [
                    "id",
                    "email",
                    "first_name",
                    "last_name",
                    "avatar",
                    "description",
                ],
            }).catch(() => []),
    );
    return toAppProfileView(profile, users[0]);
}

export async function loadAdministratorSidebarFallbackSourceFromRepository(): Promise<AdministratorSidebarFallbackSource | null> {
    return await withServiceRepositoryContext(async () => {
        const roles = await listDirectusRoles().catch(() => []);
        const administratorRole = roles.find((role) =>
            isPlatformAdministratorRoleName(role.name),
        );
        const administratorUserIds = Array.from(
            new Set(
                (administratorRole?.users ?? [])
                    .map((userId) => String(userId || "").trim())
                    .filter(Boolean),
            ),
        );
        if (administratorUserIds.length === 0) {
            return null;
        }

        const profiles = (await readMany("app_user_profiles", {
            filter: {
                _and: [
                    { user_id: { _in: administratorUserIds } },
                    { profile_public: { _eq: true } },
                    { status: { _eq: "published" } },
                ],
            } as JsonObject,
            limit: 1,
            sort: ["date_created"],
        })) as AppProfile[];
        const profile = profiles[0];
        if (!profile) {
            return null;
        }

        const users = (await readMany("directus_users", {
            filter: { id: { _eq: profile.user_id } } as JsonObject,
            limit: 1,
            fields: [
                "id",
                "email",
                "first_name",
                "last_name",
                "avatar",
                "description",
            ],
        }).catch(() => [])) as Array<
            Pick<
                AppUser,
                | "id"
                | "email"
                | "first_name"
                | "last_name"
                | "avatar"
                | "description"
            >
        >;

        return {
            profile: toAppProfileView(profile, users[0] ?? null),
        };
    });
}

export async function listHomeArticlesFromRepository(params: {
    targetUserId: string;
    filters: JsonObject[];
}): Promise<AppArticle[]> {
    return (await readMany("app_articles", {
        filter: {
            _and: [
                { author_id: { _eq: params.targetUserId } },
                ...params.filters,
            ],
        } as JsonObject,
        sort: ["-date_updated", "-date_created"],
        limit: 5,
    })) as AppArticle[];
}

export async function listHomeDiariesFromRepository(params: {
    targetUserId: string;
    filters: JsonObject[];
}): Promise<AppDiary[]> {
    return (await readMany("app_diaries", {
        filter: {
            _and: [
                { author_id: { _eq: params.targetUserId } },
                ...params.filters,
            ],
        } as JsonObject,
        fields: ["*"],
        sort: ["-date_created"],
        limit: 5,
    })) as AppDiary[];
}

export async function listHomeAlbumsFromRepository(params: {
    targetUserId: string;
    filters: JsonObject[];
}): Promise<AppAlbum[]> {
    return (await readMany("app_albums", {
        filter: {
            _and: [
                { author_id: { _eq: params.targetUserId } },
                ...params.filters,
            ],
        } as JsonObject,
        sort: ["-date", "-date_created"],
        limit: 5,
    })) as AppAlbum[];
}

export async function fetchDiaryCommentCountMapFromRepository(
    diaryIds: string[],
): Promise<Map<string, number>> {
    if (diaryIds.length === 0) {
        return new Map();
    }
    return await countItemsGroupedByField("app_diary_comments", "diary_id", {
        _and: [
            { diary_id: { _in: diaryIds } },
            { status: { _eq: "published" } },
            { is_public: { _eq: true } },
        ],
    } as JsonObject);
}

export async function fetchDiaryLikeCountMapFromRepository(
    diaryIds: string[],
): Promise<Map<string, number>> {
    if (diaryIds.length === 0) {
        return new Map();
    }
    return await countItemsGroupedByField("app_diary_likes", "diary_id", {
        _and: [
            { diary_id: { _in: diaryIds } },
            { status: { _eq: "published" } },
        ],
    } as JsonObject);
}

export async function loadDiaryImagesForIdsFromRepository(
    diaryIds: string[],
    isOwnerViewing: boolean,
): Promise<AppDiaryImage[]> {
    const diaryImageFilters: JsonObject[] = [{ diary_id: { _in: diaryIds } }];
    if (!isOwnerViewing) {
        diaryImageFilters.push(
            { status: { _eq: "published" } },
            { is_public: { _eq: true } },
        );
    }
    return (await readMany("app_diary_images", {
        filter:
            diaryIds.length > 0
                ? ({ _and: diaryImageFilters } as JsonObject)
                : ({ id: { _null: true } } as JsonObject),
        sort: ["sort", "-date_created"],
        limit: Math.max(diaryIds.length * 6, 20),
    })) as AppDiaryImage[];
}

export async function listUserDiariesFromRepository(params: {
    userId: string;
    filters: JsonObject[];
    limit: number;
    offset: number;
}): Promise<{ rows: AppDiary[]; total: number }> {
    const diaryFilter = {
        _and: [...params.filters, { author_id: { _eq: params.userId } }],
    } as JsonObject;
    const [rows, total] = await Promise.all([
        readMany("app_diaries", {
            filter: diaryFilter,
            fields: [...DIARY_FIELDS],
            sort: ["-date_created"],
            limit: params.limit,
            offset: params.offset,
        }),
        countItems("app_diaries", diaryFilter),
    ]);
    return { rows: rows as AppDiary[], total };
}

export async function loadOwnedDiaryByShortIdFromRepository(
    shortId: string,
): Promise<AppDiary | null> {
    const rows = await readMany("app_diaries", {
        filter: { short_id: { _eq: shortId } } as JsonObject,
        fields: [...DIARY_FIELDS],
        limit: 1,
    });
    return (rows[0] as AppDiary | undefined) ?? null;
}

export async function loadDiaryImagesForDiaryFromRepository(
    diaryId: string,
    isOwnerViewing: boolean,
): Promise<AppDiaryImage[]> {
    const diaryImageFilters: JsonObject[] = [{ diary_id: { _eq: diaryId } }];
    if (!isOwnerViewing) {
        diaryImageFilters.push(
            { status: { _eq: "published" } },
            { is_public: { _eq: true } },
        );
    }
    return (await readMany("app_diary_images", {
        filter: { _and: diaryImageFilters } as JsonObject,
        sort: ["sort", "-date_created"],
        limit: 100,
    })) as AppDiaryImage[];
}

export async function listUserAlbumsFromRepository(params: {
    userId: string;
    filters: JsonObject[];
    limit: number;
    offset: number;
}): Promise<{ rows: AppAlbum[]; total: number }> {
    const albumFilter = {
        _and: [...params.filters, { author_id: { _eq: params.userId } }],
    } as JsonObject;
    const [rows, total] = await Promise.all([
        readMany("app_albums", {
            filter: albumFilter,
            sort: ["-date", "-date_created"],
            limit: params.limit,
            offset: params.offset,
        }),
        countItems("app_albums", albumFilter),
    ]);
    return { rows: rows as AppAlbum[], total };
}

export async function loadOwnedAlbumByShortIdFromRepository(
    shortId: string,
): Promise<AppAlbum | null> {
    const rows = await readMany("app_albums", {
        filter: { short_id: { _eq: shortId } } as JsonObject,
        limit: 1,
    });
    return (rows[0] as AppAlbum | undefined) ?? null;
}

export async function loadAlbumPhotosForAlbumFromRepository(
    albumId: string,
    isOwnerViewing: boolean,
): Promise<AppAlbumPhoto[]> {
    const photoFilters: JsonObject[] = [{ album_id: { _eq: albumId } }];
    if (!isOwnerViewing) {
        photoFilters.push(
            { status: { _eq: "published" } },
            { is_public: { _eq: true } },
        );
    }
    return (await readMany("app_album_photos", {
        filter: { _and: photoFilters } as JsonObject,
        sort: ["sort", "-date_created"],
        limit: 200,
    })) as AppAlbumPhoto[];
}
