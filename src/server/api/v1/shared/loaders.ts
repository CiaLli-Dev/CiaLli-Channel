import type { AppAlbum, AppArticle, AppDiary, AppFriend } from "@/types/app";
import {
    ensureUsernameAvailableFromRepository,
    loadArticleByShortIdLooseFromRepository,
    loadArticleBySlugLooseFromRepository,
    loadPublicAlbumByIdFromRepository,
    loadPublicAlbumByShortIdFromRepository,
    loadPublicArticleByIdFromRepository,
    loadPublicArticleByShortIdFromRepository,
    loadPublicArticleBySlugFromRepository,
    loadPublicDiaryByIdFromRepository,
    loadPublicDiaryByShortIdFromRepository,
    loadPublicFriendsFromRepository,
} from "@/server/repositories/public/loaders.repository";

export async function loadPublicArticleById(
    id: string,
): Promise<AppArticle | null> {
    return await loadPublicArticleByIdFromRepository(id);
}

export async function loadPublicArticleBySlug(
    slug: string,
): Promise<AppArticle | null> {
    return await loadPublicArticleBySlugFromRepository(slug);
}

export async function loadPublicFriends(): Promise<AppFriend[]> {
    return await loadPublicFriendsFromRepository();
}

/** 宽松版本：不检查 status/is_public（用于 owner 回退） */
export async function loadArticleBySlugLoose(
    slug: string,
): Promise<AppArticle | null> {
    return await loadArticleBySlugLooseFromRepository(slug);
}

export async function loadPublicArticleByShortId(
    shortId: string,
): Promise<AppArticle | null> {
    return await loadPublicArticleByShortIdFromRepository(shortId);
}

/** 宽松版本：不检查 status/is_public（用于 owner 回退） */
export async function loadArticleByShortIdLoose(
    shortId: string,
): Promise<AppArticle | null> {
    return await loadArticleByShortIdLooseFromRepository(shortId);
}

export async function loadPublicDiaryById(
    id: string,
): Promise<AppDiary | null> {
    return await loadPublicDiaryByIdFromRepository(id);
}

export async function loadPublicDiaryByShortId(
    shortId: string,
): Promise<AppDiary | null> {
    return await loadPublicDiaryByShortIdFromRepository(shortId);
}

export async function loadPublicAlbumById(
    id: string,
): Promise<AppAlbum | null> {
    return await loadPublicAlbumByIdFromRepository(id);
}

export async function loadPublicAlbumByShortId(
    shortId: string,
): Promise<AppAlbum | null> {
    return await loadPublicAlbumByShortIdFromRepository(shortId);
}

export async function ensureUsernameAvailable(
    username: string,
    excludeProfileId?: string,
): Promise<void> {
    await ensureUsernameAvailableFromRepository(username, excludeProfileId);
}
