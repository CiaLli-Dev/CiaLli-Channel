import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type { JsonObject } from "@/types/json";
import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import { badRequest } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import {
    CreateDiaryImageSchema,
    CreateDiarySchema,
    DiaryPreviewSchema,
    UpsertDiaryWorkingDraftSchema,
    type UpdateDiaryImageInput,
    type UpdateDiaryInput,
    type UpsertDiaryWorkingDraftInput,
    UpdateDiaryImageSchema,
    UpdateDiarySchema,
} from "@/server/api/schemas";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import {
    createOne,
    deleteOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { createWithShortId } from "@/server/utils/short-id";
import type { AppAccess } from "@/server/api/v1/shared";
import { DIARY_FIELDS, hasOwn, parseRouteId } from "@/server/api/v1/shared";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup";
import {
    bindFileOwnerToUser,
    renderMeMarkdownPreview,
    syncManagedFileBinding,
    syncMarkdownFileLifecycle,
    syncMarkdownFilesToVisibility,
} from "@/server/api/v1/me/_helpers";
import { readComments } from "@/server/repositories/comments/comments.repository";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";
import { searchIndex } from "@/server/application/shared/search-index";

function buildDiaryFileTitle(
    shortIdValue: unknown,
    sortValue: unknown,
): string {
    const normalizedShortId = String(shortIdValue ?? "").trim() || "unknown";
    const sortNumber =
        typeof sortValue === "number" && Number.isFinite(sortValue)
            ? sortValue
            : null;
    if (sortNumber === null) {
        return `Diary ${normalizedShortId}`;
    }
    const index = Math.max(1, Math.floor(sortNumber) + 1);
    return `Diary ${normalizedShortId}-${String(index).padStart(2, "0")}`;
}

function buildDiaryDetailInvalidationTasks(
    id: string,
    shortId?: string | null,
): Array<Promise<void>> {
    const tasks: Array<Promise<void>> = [
        cacheManager.invalidate("diary-detail", id),
    ];
    const normalizedShortId = String(shortId ?? "").trim();
    if (normalizedShortId) {
        tasks.push(cacheManager.invalidate("diary-detail", normalizedShortId));
    }
    return tasks;
}

type OwnedDiaryRecord = JsonObject & {
    id: string;
    author_id: string;
    short_id?: string | null;
};

function normalizeDiaryStatus(value: unknown): "draft" | "published" {
    return value === "published" ? "published" : "draft";
}

function resolveDiaryAssetVisibility(
    status: unknown,
    praviate: unknown,
): "private" | "public" {
    return normalizeDiaryStatus(status) === "published" && praviate === true
        ? "public"
        : "private";
}

function normalizeDiaryContent(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function assertDiaryPublishable(candidate: { content: unknown }): void {
    if (!normalizeDiaryContent(candidate.content)) {
        throw badRequest("VALIDATION_ERROR", "content: 日记内容必填");
    }
}

function isUuidLike(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}

async function resolveOwnedDiary(
    identifier: string,
    ownerId: string,
): Promise<OwnedDiaryRecord | null> {
    const normalizedIdentifier = String(identifier ?? "").trim();
    if (!normalizedIdentifier) {
        return null;
    }

    const matchFilters: JsonObject[] = [
        { short_id: { _eq: normalizedIdentifier } as JsonObject },
    ];
    if (isUuidLike(normalizedIdentifier)) {
        matchFilters.push({ id: { _eq: normalizedIdentifier } as JsonObject });
    }

    const rows = await readMany("app_diaries", {
        filter: {
            _and: [
                { author_id: { _eq: ownerId } },
                {
                    _or: matchFilters,
                },
            ],
        } as JsonObject,
        fields: [...DIARY_FIELDS],
        limit: 1,
    });
    const first = rows[0] as JsonObject | undefined;
    if (!first) {
        return null;
    }
    return {
        ...first,
        id: String(first.id),
        author_id: String(first.author_id ?? "").trim(),
        short_id:
            first.short_id === null || first.short_id === undefined
                ? null
                : String(first.short_id),
    };
}

async function resolveOwnedWorkingDraft(
    ownerId: string,
): Promise<OwnedDiaryRecord | null> {
    const rows = await readMany("app_diaries", {
        filter: {
            _and: [
                { author_id: { _eq: ownerId } },
                { status: { _eq: "draft" } },
            ],
        } as JsonObject,
        fields: [...DIARY_FIELDS],
        sort: ["-date_updated", "-date_created"],
        limit: 1,
    });
    const first = rows[0] as JsonObject | undefined;
    if (!first) {
        return null;
    }
    return {
        ...first,
        id: String(first.id),
        author_id: String(first.author_id ?? "").trim(),
        short_id:
            first.short_id === null || first.short_id === undefined
                ? null
                : String(first.short_id),
    };
}

async function loadOwnedDiaryImages(diaryId: string): Promise<JsonObject[]> {
    return (await readMany("app_diary_images", {
        filter: {
            diary_id: { _eq: diaryId },
        } as JsonObject,
        sort: ["sort", "-date_created"],
        limit: 100,
    })) as JsonObject[];
}

function buildDiaryWorkingDraftCreatePayload(
    input: UpsertDiaryWorkingDraftInput,
    access: AppAccess,
): JsonObject {
    return {
        status: "draft",
        author_id: access.user.id,
        content: input.content ?? "",
        allow_comments: input.allow_comments ?? true,
        praviate: input.praviate ?? true,
    };
}

function buildDiaryWorkingDraftUpdatePayload(
    input: UpsertDiaryWorkingDraftInput,
): JsonObject {
    return {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.allow_comments !== undefined
            ? { allow_comments: input.allow_comments }
            : {}),
        ...(input.praviate !== undefined ? { praviate: input.praviate } : {}),
        status: "draft",
    };
}

function buildDiaryPatchPayload(
    input: UpdateDiaryInput,
    target: OwnedDiaryRecord,
): {
    payload: JsonObject;
    nextStatus: "draft" | "published";
    nextPraviate: boolean;
    nextContent: string;
} {
    const payload: JsonObject = {};
    if (input.content !== undefined) {
        payload.content = input.content;
    }
    if (input.allow_comments !== undefined) {
        payload.allow_comments = input.allow_comments;
    }
    if (input.praviate !== undefined) {
        payload.praviate = input.praviate;
    }
    const nextStatus =
        input.status !== undefined
            ? normalizeDiaryStatus(input.status)
            : normalizeDiaryStatus(target.status);
    if (input.status !== undefined) {
        payload.status = nextStatus;
    }
    return {
        payload,
        nextStatus,
        nextPraviate:
            input.praviate !== undefined
                ? input.praviate
                : Boolean(target.praviate),
        nextContent:
            input.content !== undefined
                ? String(input.content)
                : String(target.content ?? ""),
    };
}

async function syncDiaryFilesVisibility(
    diaryId: string,
    shortId: string | null | undefined,
    ownerId: string,
    visibility: "private" | "public",
): Promise<void> {
    const imageRows = await readMany("app_diary_images", {
        filter: { diary_id: { _eq: diaryId } } as JsonObject,
        fields: ["id", "file_id", "is_public", "sort"],
        limit: 200,
    });
    for (const image of imageRows) {
        const fileId = normalizeDirectusFileId(image.file_id);
        if (!fileId) {
            continue;
        }
        await bindFileOwnerToUser(
            fileId,
            ownerId,
            buildDiaryFileTitle(shortId, image.sort),
            visibility === "public" && image.is_public ? "public" : "private",
            {
                ownerCollection: "app_diary_images",
                ownerId: String(image.id ?? ""),
                ownerField: "file_id",
                referenceKind: "structured_field",
            },
        );
    }
}

async function handleDiaryPreview(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }
    assertCan(access, "can_manage_diaries");
    const body = await parseJsonBody(context.request);
    const input = validateBody(DiaryPreviewSchema, body);
    const renderStart = performance.now();
    const bodyHtml = await renderMeMarkdownPreview(
        input.content,
        input.render_mode,
    );
    const renderDuration = performance.now() - renderStart;
    return ok(
        {
            content: input.content,
            body_html: bodyHtml,
        },
        {
            headers:
                process.env.NODE_ENV === "production"
                    ? undefined
                    : {
                          "Server-Timing": `md-render;dur=${renderDuration.toFixed(2)};desc="${input.render_mode}"`,
                      },
        },
    );
}

async function handleDiaryListGet(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url);
    const rows = await readMany("app_diaries", {
        filter: {
            author_id: { _eq: access.user.id },
        } as JsonObject,
        fields: [...DIARY_FIELDS],
        sort: ["-date_created"],
        limit,
        offset,
    });
    return ok({
        items: rows,
        page,
        limit,
        total: rows.length,
    });
}

async function handleDiaryCreate(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    assertCan(access, "can_manage_diaries");
    const body = await parseJsonBody(context.request);
    const input = validateBody(CreateDiarySchema, body);

    const diaryPayload = {
        status: "published" as const,
        author_id: access.user.id,
        content: input.content,
        allow_comments: input.allow_comments,
        praviate: input.praviate,
    };

    const created = await createWithShortId(
        "app_diaries",
        diaryPayload,
        (collection, payload) =>
            createOne(collection, payload, {
                fields: [...DIARY_FIELDS],
            }),
    );
    await syncMarkdownFilesToVisibility(
        created.content,
        access.user.id,
        resolveDiaryAssetVisibility(created.status, created.praviate),
        {
            ownerCollection: "app_diaries",
            ownerId: created.id,
            ownerField: "content",
            referenceKind: "markdown_asset",
        },
    );
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("mixed-feed"),
        ],
        { label: "me/diaries#create" },
    );
    return ok({ item: created });
}

async function handleDiaryGet(
    diaryId: string,
    target: OwnedDiaryRecord,
): Promise<Response> {
    const images = await loadOwnedDiaryImages(diaryId);
    return ok({ item: target, images });
}

async function handleDiaryPatch(
    context: APIContext,
    diaryId: string,
    target: OwnedDiaryRecord,
    access: AppAccess,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateDiarySchema, body);
    const currentStatus = normalizeDiaryStatus(target.status);
    const { payload, nextStatus, nextPraviate, nextContent } =
        buildDiaryPatchPayload(input, target);
    if (currentStatus === "published" && nextStatus === "draft") {
        throw badRequest(
            "INVALID_STATUS_TRANSITION",
            "不允许从 published 转换到 draft",
        );
    }
    if (nextStatus === "published") {
        assertDiaryPublishable({ content: nextContent });
    }
    const updated = await updateOne("app_diaries", diaryId, payload, {
        fields: [...DIARY_FIELDS],
    });
    if (
        input.content !== undefined ||
        input.praviate !== undefined ||
        input.status !== undefined
    ) {
        await syncMarkdownFileLifecycle({
            previousMarkdown: String(target.content ?? ""),
            nextMarkdown: nextContent,
            userId: access.user.id,
            visibility: resolveDiaryAssetVisibility(nextStatus, nextPraviate),
            reference: {
                ownerCollection: "app_diaries",
                ownerId: diaryId,
                ownerField: "content",
                referenceKind: "markdown_asset",
            },
        });
    }
    if (input.praviate !== undefined || input.status !== undefined) {
        await syncDiaryFilesVisibility(
            diaryId,
            updated.short_id,
            updated.author_id,
            resolveDiaryAssetVisibility(nextStatus, nextPraviate),
        );
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("mixed-feed"),
            ...buildDiaryDetailInvalidationTasks(diaryId, updated.short_id),
        ],
        { label: "me/diaries#patch" },
    );
    return ok({ item: updated });
}

async function handleWorkingDraftGet(access: AppAccess): Promise<Response> {
    const draft = await resolveOwnedWorkingDraft(access.user.id);
    if (!draft) {
        return ok({ item: null, images: [] });
    }
    return ok({
        item: draft,
        images: await loadOwnedDiaryImages(draft.id),
    });
}

async function handleWorkingDraftPut(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    assertCan(access, "can_manage_diaries");
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpsertDiaryWorkingDraftSchema, body);
    const target = await resolveOwnedWorkingDraft(access.user.id);

    if (!target) {
        const created = await createWithShortId(
            "app_diaries",
            buildDiaryWorkingDraftCreatePayload(input, access),
            (collection, payload) =>
                createOne(collection, payload, {
                    fields: [...DIARY_FIELDS],
                }),
        );
        await syncMarkdownFilesToVisibility(
            created.content,
            access.user.id,
            resolveDiaryAssetVisibility(created.status, created.praviate),
            {
                ownerCollection: "app_diaries",
                ownerId: created.id,
                ownerField: "content",
                referenceKind: "markdown_asset",
            },
        );
        await awaitCacheInvalidations(
            [
                cacheManager.invalidateByDomain("diary-list"),
                cacheManager.invalidateByDomain("mixed-feed"),
            ],
            { label: "me/diaries#working-draft#create" },
        );
        return ok({
            item: created,
            images: await loadOwnedDiaryImages(String(created.id)),
        });
    }

    const payload = buildDiaryWorkingDraftUpdatePayload(input);
    const updated = await updateOne("app_diaries", target.id, payload, {
        fields: [...DIARY_FIELDS],
    });
    await syncMarkdownFileLifecycle({
        previousMarkdown: String(target.content ?? ""),
        nextMarkdown:
            input.content !== undefined
                ? input.content
                : String(target.content ?? ""),
        userId: access.user.id,
        visibility: resolveDiaryAssetVisibility(
            "draft",
            input.praviate ?? target.praviate,
        ),
        reference: {
            ownerCollection: "app_diaries",
            ownerId: target.id,
            ownerField: "content",
            referenceKind: "markdown_asset",
        },
    });
    if (input.praviate !== undefined) {
        await syncDiaryFilesVisibility(
            target.id,
            updated.short_id,
            updated.author_id,
            resolveDiaryAssetVisibility("draft", input.praviate),
        );
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("mixed-feed"),
            ...buildDiaryDetailInvalidationTasks(target.id, updated.short_id),
        ],
        { label: "me/diaries#working-draft#update" },
    );
    return ok({
        item: updated,
        images: await loadOwnedDiaryImages(target.id),
    });
}

async function handleWorkingDraft(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        return await handleWorkingDraftGet(access);
    }
    if (context.request.method === "PUT") {
        return await handleWorkingDraftPut(context, access);
    }
    return fail("方法不允许", 405);
}

async function handleDiaryDelete(
    diaryId: string,
    target: OwnedDiaryRecord,
): Promise<Response> {
    const [imageRows, commentRows] = await Promise.all([
        readMany("app_diary_images", {
            filter: { diary_id: { _eq: diaryId } } as JsonObject,
            fields: ["id"],
            limit: 5000,
        }),
        readComments("app_diary_comments", {
            filter: { diary_id: { _eq: diaryId } } as JsonObject,
            fields: ["id"],
            limit: -1,
        }),
    ]);
    for (const image of imageRows) {
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_diary_images",
            ownerId: String(image.id),
        });
    }
    for (const comment of commentRows) {
        await resourceLifecycle.releaseOwnerResources({
            ownerCollection: "app_diary_comments",
            ownerId: String(comment.id),
        });
        await searchIndex.remove("comment", String(comment.id));
    }
    await resourceLifecycle.releaseOwnerResources({
        ownerCollection: "app_diaries",
        ownerId: diaryId,
    });
    await deleteOne("app_diaries", diaryId);
    await searchIndex.remove("diary", diaryId);
    console.info("[audit] diary.delete", {
        diaryId,
        authorId: target.author_id,
        releasedImageCount: imageRows.length,
        releasedCommentCount: commentRows.length,
    });
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("mixed-feed"),
            ...buildDiaryDetailInvalidationTasks(diaryId, target.short_id),
        ],
        { label: "me/diaries#delete" },
    );
    return ok({ id: diaryId });
}

async function handleSingleDiary(
    context: APIContext,
    access: AppAccess,
    identifier: string,
): Promise<Response> {
    const target = await resolveOwnedDiary(identifier, access.user.id);
    if (!target) {
        return fail("日记不存在", 404);
    }
    assertOwnerOrAdmin(access, target.author_id);
    const diaryId = String(target.id);

    if (context.request.method === "GET") {
        return await handleDiaryGet(diaryId, target);
    }
    if (context.request.method === "PATCH") {
        return await handleDiaryPatch(context, diaryId, target, access);
    }
    if (context.request.method === "DELETE") {
        return await handleDiaryDelete(diaryId, target);
    }
    return fail("未找到接口", 404);
}

export async function handleMyDiaries(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 2 && segments[1] === "preview") {
        return await handleDiaryPreview(context, access);
    }
    if (segments.length === 2 && segments[1] === "working-draft") {
        return await handleWorkingDraft(context, access);
    }

    if (segments.length === 1) {
        if (context.request.method === "GET") {
            return await handleDiaryListGet(context, access);
        }
        if (context.request.method === "POST") {
            return await handleDiaryCreate(context, access);
        }
    }

    if (segments.length === 2) {
        const identifier = parseRouteId(segments[1]);
        if (!identifier) {
            return fail("缺少日记 ID", 400);
        }
        return await handleSingleDiary(context, access, identifier);
    }

    return fail("未找到接口", 404);
}

async function handleDiaryImageCreate(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    assertCan(access, "can_manage_diaries");
    const diaryIdentifier = parseRouteId(segments[1]);
    if (!diaryIdentifier) {
        return fail("缺少日记 ID", 400);
    }
    const diary = await resolveOwnedDiary(diaryIdentifier, access.user.id);
    if (!diary) {
        return fail("日记不存在", 404);
    }
    assertOwnerOrAdmin(access, diary.author_id);
    const diaryId = String(diary.id);
    const body = await parseJsonBody(context.request);
    const input = validateBody(CreateDiaryImageSchema, body);
    const created = await createOne("app_diary_images", {
        status: input.is_public ? "published" : "archived",
        diary_id: diaryId,
        file_id: input.file_id ?? null,
        image_url: input.image_url ?? null,
        caption: input.caption ?? null,
        sort: input.sort ?? null,
        is_public: input.is_public,
        show_on_profile: input.show_on_profile,
    });
    if (created.file_id) {
        await bindFileOwnerToUser(
            created.file_id,
            access.user.id,
            buildDiaryFileTitle(diary.short_id, created.sort),
            resolveDiaryAssetVisibility(diary.status, diary.praviate) ===
                "public" && created.is_public
                ? "public"
                : "private",
            {
                ownerCollection: "app_diary_images",
                ownerId: created.id,
                ownerField: "file_id",
                referenceKind: "structured_field",
            },
        );
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("mixed-feed"),
            ...buildDiaryDetailInvalidationTasks(diaryId, diary.short_id),
        ],
        { label: "me/diary-images#create" },
    );
    return ok({ item: created });
}

async function buildDiaryImagePatchPayload(context: APIContext): Promise<{
    payload: JsonObject;
    input: UpdateDiaryImageInput;
    body: JsonObject;
    prevFileId: string | null;
    nextFileId: string | null;
}> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateDiaryImageSchema, body);
    const payload: JsonObject = {};
    const prevFileId = normalizeDirectusFileId((body as JsonObject).file_id);
    let nextFileId = prevFileId;
    if (hasOwn(body as JsonObject, "file_id")) {
        nextFileId = normalizeDirectusFileId(input.file_id);
        payload.file_id = input.file_id ?? null;
    }
    if (input.image_url !== undefined) {
        payload.image_url = input.image_url;
    }
    if (input.caption !== undefined) {
        payload.caption = input.caption;
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
    return { payload, input, body: body as JsonObject, prevFileId, nextFileId };
}

async function handleDiaryImagePatch(
    context: APIContext,
    access: AppAccess,
    imageId: string,
    image: JsonObject,
    diary: JsonObject,
): Promise<Response> {
    const { payload, input, body, nextFileId } =
        await buildDiaryImagePatchPayload(context);
    const updated = await updateOne("app_diary_images", imageId, payload);
    const nextVisibility =
        resolveDiaryAssetVisibility(diary.status, diary.praviate) ===
            "public" &&
        (updated.is_public ?? image.is_public)
            ? "public"
            : "private";
    if (hasOwn(body, "file_id")) {
        await syncManagedFileBinding({
            previousFileValue: image.file_id,
            nextFileValue: nextFileId,
            userId: access.user.id,
            title: buildDiaryFileTitle(diary.short_id, updated.sort),
            visibility: nextVisibility,
            reference: {
                ownerCollection: "app_diary_images",
                ownerId: imageId,
                ownerField: "file_id",
                referenceKind: "structured_field",
            },
        });
    } else if (nextFileId && input.is_public !== undefined) {
        await bindFileOwnerToUser(
            nextFileId,
            access.user.id,
            buildDiaryFileTitle(diary.short_id, updated.sort),
            nextVisibility,
            {
                ownerCollection: "app_diary_images",
                ownerId: imageId,
                ownerField: "file_id",
                referenceKind: "structured_field",
            },
        );
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("mixed-feed"),
            ...buildDiaryDetailInvalidationTasks(
                String(image.diary_id ?? ""),
                typeof diary.short_id === "string" ? diary.short_id : null,
            ),
        ],
        { label: "me/diary-images#patch" },
    );
    return ok({ item: updated });
}

async function handleDiaryImageDelete(
    imageId: string,
    image: JsonObject,
    diary: JsonObject,
): Promise<Response> {
    await resourceLifecycle.releaseOwnerResources({
        ownerCollection: "app_diary_images",
        ownerId: imageId,
    });
    await deleteOne("app_diary_images", imageId);
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("mixed-feed"),
            ...buildDiaryDetailInvalidationTasks(
                String(image.diary_id ?? ""),
                typeof diary.short_id === "string" ? diary.short_id : null,
            ),
        ],
        { label: "me/diary-images#delete" },
    );
    return ok({ id: imageId });
}

async function handleSingleDiaryImage(
    context: APIContext,
    access: AppAccess,
    imageId: string,
): Promise<Response> {
    const image = await readOneById("app_diary_images", imageId);
    if (!image) {
        return fail("图片不存在", 404);
    }
    const diary = await readOneById("app_diaries", image.diary_id, {
        fields: [...DIARY_FIELDS],
    });
    if (!diary) {
        return fail("日记不存在", 404);
    }
    assertOwnerOrAdmin(access, diary.author_id);

    if (context.request.method === "PATCH") {
        return await handleDiaryImagePatch(
            context,
            access,
            imageId,
            image as JsonObject,
            diary as JsonObject,
        );
    }
    if (context.request.method === "DELETE") {
        return await handleDiaryImageDelete(
            imageId,
            image as JsonObject,
            diary as JsonObject,
        );
    }
    return fail("未找到接口", 404);
}

export async function handleMyDiaryImages(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 3 && context.request.method === "POST") {
        return await handleDiaryImageCreate(context, access, segments);
    }

    if (segments.length === 4) {
        const imageId = parseRouteId(segments[3]);
        if (!imageId) {
            return fail("缺少图片 ID", 400);
        }
        return await handleSingleDiaryImage(context, access, imageId);
    }

    return fail("未找到接口", 404);
}
