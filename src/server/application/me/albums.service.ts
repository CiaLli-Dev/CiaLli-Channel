import type { APIContext } from "astro";

import type { AppAlbum, AppAlbumPhoto } from "@/types/app";
import {
    ALBUM_PHOTO_MAX,
    ALBUM_TITLE_MAX,
    weightedCharLength,
} from "@/constants/text-limits";
import type { JsonObject } from "@/types/json";
import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import { fail, ok } from "@/server/api/response";
import {
    CreateAlbumPhotoSchema,
    CreateAlbumSchema,
    UpdateAlbumPhotoSchema,
    UpdateAlbumSchema,
} from "@/server/api/schemas";
import type {
    UpdateAlbumInput,
    UpdateAlbumPhotoInput,
} from "@/server/api/schemas";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import {
    enqueueFileDetachJob,
    runFileDetachJobBestEffort,
} from "@/server/files/file-detach-jobs";
import {
    countItems,
    createOne,
    deleteOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import {
    createWithShortId,
    isUniqueConstraintError,
} from "@/server/utils/short-id";
import type { AppAccess } from "@/server/api/v1/shared";
import {
    hasOwn,
    parseRouteId,
    safeCsv,
    sanitizeSlug,
} from "@/server/api/v1/shared";
import {
    collectAlbumFileIds,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup";
import {
    bindFileOwnerToUser,
    isSlugUniqueConflict,
    syncManagedFileBinding,
} from "@/server/api/v1/me/_helpers";

async function handleAlbumsGet(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url);
    const rows = await readMany("app_albums", {
        filter: {
            author_id: { _eq: access.user.id },
        } as JsonObject,
        sort: ["-date", "-date_created"],
        limit,
        offset,
    });
    return ok({
        items: rows.map((row) => ({ ...row, tags: safeCsv(row.tags) })),
        page,
        limit,
        total: rows.length,
    });
}

async function createAlbumWithSlugRetry(
    albumPayload: Omit<
        AppAlbum,
        "id" | "short_id" | "date_created" | "date_updated"
    >,
    baseSlug: string,
    userId: string,
): Promise<AppAlbum> {
    let created: AppAlbum | null = null;
    let nextSlug = baseSlug;
    let slugSuffix = 1;
    const maxAlbumCreateRetries = 6;
    for (let attempt = 0; attempt < maxAlbumCreateRetries; attempt++) {
        try {
            created = await createWithShortId(
                "app_albums",
                { ...albumPayload, slug: nextSlug },
                createOne,
            );
            break;
        } catch (error) {
            if (
                isUniqueConstraintError(error) &&
                isSlugUniqueConflict(error) &&
                attempt < maxAlbumCreateRetries - 1
            ) {
                slugSuffix += 1;
                nextSlug = `${baseSlug}-${slugSuffix}`;
                continue;
            }
            throw error;
        }
    }
    if (created?.cover_file) {
        await bindFileOwnerToUser(
            created.cover_file,
            userId,
            undefined,
            created.is_public ? "public" : "private",
        );
    }
    return created!;
}

async function handleAlbumsPost(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    assertCan(access, "can_manage_albums");
    const body = await parseJsonBody(context.request);
    const input = validateBody(CreateAlbumSchema, body);

    if (weightedCharLength(input.title) > ALBUM_TITLE_MAX) {
        return fail(
            `相册标题过长（最多 ${ALBUM_TITLE_MAX} 字符，中文算 2 字符）`,
            400,
        );
    }

    const baseSlug = sanitizeSlug(input.slug || input.title);
    const albumPayload = {
        status: (input.is_public
            ? "published"
            : "private") as AppAlbum["status"],
        author_id: access.user.id,
        title: input.title,
        slug: baseSlug,
        description: input.description ?? null,
        cover_file: input.cover_file ?? null,
        cover_url: input.cover_url ?? null,
        date: input.date ?? null,
        location: input.location ?? null,
        tags: input.tags,
        category: input.category ?? null,
        layout: input.layout,
        columns: input.columns,
        is_public: input.is_public,
    };

    const created = await createAlbumWithSlugRetry(
        albumPayload,
        baseSlug,
        access.user.id,
    );
    await awaitCacheInvalidations(
        [cacheManager.invalidateByDomain("album-list")],
        { label: "me/albums#create" },
    );
    return ok({ item: { ...created, tags: safeCsv(created?.tags) } });
}

async function handleAlbumGet(id: string, target: AppAlbum): Promise<Response> {
    const photos = await readMany("app_album_photos", {
        filter: {
            album_id: { _eq: id },
        } as JsonObject,
        sort: ["sort", "-date_created"],
        limit: 200,
    });
    return ok({
        item: { ...target, tags: safeCsv(target.tags) },
        photos: photos.map((photo) => ({
            ...photo,
            tags: safeCsv(photo.tags),
        })),
    });
}

type AlbumInput = UpdateAlbumInput;

function applyAlbumMetaFields(input: AlbumInput, payload: JsonObject): void {
    if (input.title !== undefined) {
        payload.title = input.title;
    }
    if (input.slug !== undefined) {
        payload.slug = input.slug ? sanitizeSlug(input.slug) : null;
    }
    if (input.description !== undefined) {
        payload.description = input.description;
    }
    if (input.cover_url !== undefined) {
        payload.cover_url = input.cover_url;
    }
    if (input.date !== undefined) {
        payload.date = input.date;
    }
    if (input.location !== undefined) {
        payload.location = input.location;
    }
}

function applyAlbumClassifyFields(
    input: AlbumInput,
    payload: JsonObject,
): void {
    if (input.tags !== undefined) {
        payload.tags = input.tags;
    }
    if (input.category !== undefined) {
        payload.category = input.category;
    }
    if (input.layout !== undefined) {
        payload.layout = input.layout;
    }
    if (input.columns !== undefined) {
        payload.columns = input.columns;
    }
    if (input.is_public !== undefined) {
        payload.is_public = input.is_public;
        payload.status = input.is_public ? "published" : "private";
    }
}

function buildAlbumPatchPayload(
    body: JsonObject,
    input: AlbumInput,
    prevCoverFile: string | null,
): { payload: JsonObject; nextCoverFile: string | null } {
    const payload: JsonObject = {};
    let nextCoverFile = prevCoverFile;

    applyAlbumMetaFields(input, payload);
    applyAlbumClassifyFields(input, payload);

    if (hasOwn(body, "cover_file")) {
        nextCoverFile = normalizeDirectusFileId(input.cover_file);
        payload.cover_file = input.cover_file ?? null;
    }

    return { payload, nextCoverFile };
}

async function handleAlbumPatch(
    context: APIContext,
    access: AppAccess,
    id: string,
    target: AppAlbum,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateAlbumSchema, body);

    if (
        input.title !== undefined &&
        input.title &&
        weightedCharLength(input.title) > ALBUM_TITLE_MAX
    ) {
        return fail(
            `相册标题过长（最多 ${ALBUM_TITLE_MAX} 字符，中文算 2 字符）`,
            400,
        );
    }

    const prevCoverFile = normalizeDirectusFileId(target.cover_file);
    const { payload, nextCoverFile } = buildAlbumPatchPayload(
        body as JsonObject,
        input,
        prevCoverFile,
    );

    const updated = await updateOne("app_albums", id, payload);

    await syncAlbumCoverVisibility({
        body: body as JsonObject,
        access,
        target,
        prevCoverFile,
        nextCoverFile,
        updatedIsPublic: updated.is_public,
        input,
        albumId: id,
    });
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("album-list"),
            cacheManager.invalidate("album-detail", id),
        ],
        { label: "me/albums#patch" },
    );
    return ok({ item: { ...updated, tags: safeCsv(updated.tags) } });
}

async function syncAlbumCoverVisibility(params: {
    body: JsonObject;
    access: AppAccess;
    target: AppAlbum;
    prevCoverFile: string | null;
    nextCoverFile: string | null;
    updatedIsPublic: boolean;
    input: AlbumInput;
    albumId: string;
}): Promise<void> {
    if (hasOwn(params.body, "cover_file")) {
        await syncManagedFileBinding({
            previousFileValue: params.target.cover_file,
            nextFileValue: params.nextCoverFile,
            userId: params.access.user.id,
            visibility: params.updatedIsPublic ? "public" : "private",
        });
    }
    if (
        params.input.is_public !== undefined &&
        params.prevCoverFile &&
        !hasOwn(params.body, "cover_file")
    ) {
        await bindFileOwnerToUser(
            params.prevCoverFile,
            params.access.user.id,
            undefined,
            params.updatedIsPublic ? "public" : "private",
        );
    }
    if (params.input.is_public !== undefined) {
        await syncAlbumPhotoVisibility(
            params.albumId,
            params.access.user.id,
            params.updatedIsPublic,
        );
    }
}

async function syncAlbumPhotoVisibility(
    albumId: string,
    userId: string,
    albumIsPublic: boolean,
): Promise<void> {
    const photoRows = await readMany("app_album_photos", {
        filter: { album_id: { _eq: albumId } } as JsonObject,
        fields: ["file_id", "is_public"],
        limit: 300,
    });
    for (const photo of photoRows) {
        const fileId = normalizeDirectusFileId(photo.file_id);
        if (!fileId) {
            continue;
        }
        await bindFileOwnerToUser(
            fileId,
            userId,
            undefined,
            albumIsPublic && photo.is_public ? "public" : "private",
        );
    }
}

async function handleAlbumDelete(
    id: string,
    target: AppAlbum,
): Promise<Response> {
    const coverFileId = normalizeDirectusFileId(target.cover_file);
    const photoFileIds = await collectAlbumFileIds(id);
    const detachJob = await enqueueFileDetachJob({
        sourceType: "me.album.delete",
        sourceId: id,
        fileValues: [...(coverFileId ? [coverFileId] : []), ...photoFileIds],
    });
    await deleteOne("app_albums", id);
    await runFileDetachJobBestEffort({
        jobId: detachJob.jobId,
        label: "me/albums#delete",
    });
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("album-list"),
            cacheManager.invalidate("album-detail", id),
        ],
        { label: "me/albums#delete" },
    );
    return ok({ id });
}

export async function handleMyAlbums(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 1) {
        if (context.request.method === "GET") {
            return await handleAlbumsGet(context, access);
        }
        if (context.request.method === "POST") {
            return await handleAlbumsPost(context, access);
        }
    }

    if (segments.length === 2) {
        const id = parseRouteId(segments[1]);
        if (!id) {
            return fail("缺少相册 ID", 400);
        }
        const target = await readOneById("app_albums", id);
        if (!target) {
            return fail("相册不存在", 404);
        }
        assertOwnerOrAdmin(access, target.author_id);

        if (context.request.method === "GET") {
            return await handleAlbumGet(id, target);
        }
        if (context.request.method === "PATCH") {
            return await handleAlbumPatch(context, access, id, target);
        }
        if (context.request.method === "DELETE") {
            return await handleAlbumDelete(id, target);
        }
    }

    return fail("未找到接口", 404);
}

async function handlePhotoPost(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    assertCan(access, "can_manage_albums");
    const albumId = parseRouteId(segments[1]);
    if (!albumId) {
        return fail("缺少相册 ID", 400);
    }
    const album = await readOneById("app_albums", albumId);
    if (!album) {
        return fail("相册不存在", 404);
    }
    assertOwnerOrAdmin(access, album.author_id);
    const photoCount = await countItems("app_album_photos", {
        album_id: { _eq: albumId },
    } as JsonObject);
    if (photoCount >= ALBUM_PHOTO_MAX) {
        return fail(`相册最多 ${ALBUM_PHOTO_MAX} 张照片`, 400);
    }
    const body = await parseJsonBody(context.request);
    const input = validateBody(CreateAlbumPhotoSchema, body);
    const created = await createOne("app_album_photos", {
        status: input.is_public ? "published" : "archived",
        album_id: albumId,
        file_id: input.file_id ?? null,
        image_url: input.image_url ?? null,
        title: input.title ?? null,
        description: input.description ?? null,
        tags: input.tags,
        taken_at: input.taken_at ?? null,
        location: input.location ?? null,
        sort: input.sort ?? null,
        is_public: input.is_public,
        show_on_profile: input.show_on_profile,
    });
    if (created.file_id) {
        await bindFileOwnerToUser(
            created.file_id,
            access.user.id,
            undefined,
            created.is_public && album.is_public ? "public" : "private",
        );
    }
    await awaitCacheInvalidations(
        [cacheManager.invalidate("album-detail", albumId)],
        { label: "me/album-photos#create" },
    );
    return ok({ item: { ...created, tags: safeCsv(created.tags) } });
}

function buildPhotoPatchPayload(
    body: JsonObject,
    input: UpdateAlbumPhotoInput,
    prevFileId: string | null,
): { payload: JsonObject; nextFileId: string | null } {
    const payload: JsonObject = {};
    let nextFileId = prevFileId;

    if (hasOwn(body, "file_id")) {
        nextFileId = normalizeDirectusFileId(input.file_id);
        payload.file_id = input.file_id ?? null;
    }
    if (input.image_url !== undefined) {
        payload.image_url = input.image_url;
    }
    if (input.title !== undefined) {
        payload.title = input.title;
    }
    if (input.description !== undefined) {
        payload.description = input.description;
    }
    if (input.tags !== undefined) {
        payload.tags = input.tags;
    }
    if (input.taken_at !== undefined) {
        payload.taken_at = input.taken_at;
    }
    if (input.location !== undefined) {
        payload.location = input.location;
    }
    if (input.sort !== undefined) {
        payload.sort = input.sort;
    }
    if (input.is_public !== undefined) {
        payload.is_public = input.is_public;
    }
    if (input.show_on_profile !== undefined) {
        payload.show_on_profile = input.show_on_profile;
    }
    if (input.status !== undefined) {
        payload.status = input.status;
    }

    return { payload, nextFileId };
}

async function handlePhotoPatch(
    context: APIContext,
    access: AppAccess,
    photoId: string,
    photo: AppAlbumPhoto,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateAlbumPhotoSchema, body);
    const prevFileId = normalizeDirectusFileId(photo.file_id);
    const { payload, nextFileId } = buildPhotoPatchPayload(
        body as JsonObject,
        input,
        prevFileId,
    );

    const updated = await updateOne("app_album_photos", photoId, payload);
    const album = await readOneById("app_albums", photo.album_id);

    const nextVisibility =
        (updated.is_public ?? photo.is_public) && Boolean(album?.is_public)
            ? "public"
            : "private";
    if (hasOwn(body as JsonObject, "file_id")) {
        await syncManagedFileBinding({
            previousFileValue: photo.file_id,
            nextFileValue: nextFileId,
            userId: access.user.id,
            visibility: nextVisibility,
        });
    } else if (nextFileId && input.is_public !== undefined) {
        await bindFileOwnerToUser(
            nextFileId,
            access.user.id,
            undefined,
            nextVisibility,
        );
    }
    await awaitCacheInvalidations(
        [cacheManager.invalidate("album-detail", photo.album_id)],
        { label: "me/album-photos#patch" },
    );
    return ok({ item: { ...updated, tags: safeCsv(updated.tags) } });
}

async function handlePhotoDelete(
    photoId: string,
    photo: AppAlbumPhoto,
    _ownerUserId: string,
): Promise<Response> {
    const detachJob = await enqueueFileDetachJob({
        sourceType: "me.album-photo.delete",
        sourceId: photoId,
        fileValues: [photo.file_id],
    });
    await deleteOne("app_album_photos", photoId);
    await runFileDetachJobBestEffort({
        jobId: detachJob.jobId,
        label: "me/album-photos#delete",
    });
    await awaitCacheInvalidations(
        [cacheManager.invalidate("album-detail", photo.album_id)],
        { label: "me/album-photos#delete" },
    );
    return ok({ id: photoId });
}

export async function handleMyAlbumPhotos(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 3 && context.request.method === "POST") {
        return await handlePhotoPost(context, access, segments);
    }

    if (segments.length === 4) {
        const photoId = parseRouteId(segments[3]);
        if (!photoId) {
            return fail("缺少图片 ID", 400);
        }
        const photo = await readOneById("app_album_photos", photoId);
        if (!photo) {
            return fail("图片不存在", 404);
        }
        const album = await readOneById("app_albums", photo.album_id);
        if (!album) {
            return fail("相册不存在", 404);
        }
        assertOwnerOrAdmin(access, album.author_id);

        if (context.request.method === "PATCH") {
            return await handlePhotoPatch(context, access, photoId, photo);
        }
        if (context.request.method === "DELETE") {
            return await handlePhotoDelete(photoId, photo, album.author_id);
        }
    }

    return fail("未找到接口", 404);
}
