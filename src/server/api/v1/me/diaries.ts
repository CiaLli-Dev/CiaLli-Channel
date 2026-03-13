/* eslint-disable max-lines -- 日记主体与图片子资源共用文件以保证行为一致 */
import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type { JsonObject } from "@/types/json";
import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import {
    createOne,
    deleteOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import {
    CreateDiaryImageSchema,
    CreateDiarySchema,
    DiaryPreviewSchema,
    type UpdateDiaryImageInput,
    UpdateDiaryImageSchema,
    UpdateDiarySchema,
} from "@/server/api/schemas";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import { createWithShortId } from "@/server/utils/short-id";

import type { AppAccess } from "../shared";
import { DIARY_FIELDS, hasOwn, parseRouteId } from "../shared";
import {
    cleanupOwnedOrphanDirectusFiles,
    collectDiaryCommentCleanupCandidates,
    collectDiaryFileIds,
    extractDirectusAssetIdsFromMarkdown,
    mergeDirectusFileCleanupCandidates,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";
import { bindFileOwnerToUser, renderMeMarkdownPreview } from "./_helpers";

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

// ── handleMeDiaries 辅助函数 ──────────────────────────────────────────────────

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
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "me/diaries#create" },
    );
    return ok({ item: created });
}

async function handleDiaryGet(
    diaryId: string,
    target: OwnedDiaryRecord,
): Promise<Response> {
    const images = await readMany("app_diary_images", {
        filter: {
            diary_id: { _eq: diaryId },
        } as JsonObject,
        sort: ["sort", "-date_created"],
        limit: 100,
    });
    return ok({ item: target, images });
}

async function handleDiaryPatch(
    context: APIContext,
    diaryId: string,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateDiarySchema, body);
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
    payload.status = "published";
    const updated = await updateOne("app_diaries", diaryId, payload, {
        fields: [...DIARY_FIELDS],
    });
    if (input.praviate !== undefined) {
        const imageRows = await readMany("app_diary_images", {
            filter: { diary_id: { _eq: diaryId } } as JsonObject,
            fields: ["file_id", "is_public", "sort"],
            limit: 200,
        });
        for (const image of imageRows) {
            const fileId = normalizeDirectusFileId(image.file_id);
            if (!fileId) {
                continue;
            }
            await bindFileOwnerToUser(
                fileId,
                updated.author_id,
                buildDiaryFileTitle(updated.short_id, image.sort),
                updated.praviate === true && image.is_public
                    ? "public"
                    : "private",
            );
        }
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("home-feed"),
            ...buildDiaryDetailInvalidationTasks(diaryId, updated.short_id),
        ],
        { label: "me/diaries#patch" },
    );
    return ok({ item: updated });
}

async function handleDiaryDelete(
    diaryId: string,
    target: OwnedDiaryRecord,
): Promise<Response> {
    const imageFileIds = await collectDiaryFileIds(diaryId);
    const contentFileIds = extractDirectusAssetIdsFromMarkdown(
        String(target.content ?? ""),
    );
    const relatedCommentCandidates =
        await collectDiaryCommentCleanupCandidates(diaryId);
    await deleteOne("app_diaries", diaryId);
    await cleanupOwnedOrphanDirectusFiles(
        mergeDirectusFileCleanupCandidates(
            {
                candidateFileIds: [...imageFileIds, ...contentFileIds],
                ownerUserIds: [target.author_id],
            },
            relatedCommentCandidates,
        ),
    );
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("diary-list"),
            cacheManager.invalidateByDomain("home-feed"),
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
        return handleDiaryGet(diaryId, target);
    }
    if (context.request.method === "PATCH") {
        return handleDiaryPatch(context, diaryId);
    }
    if (context.request.method === "DELETE") {
        return handleDiaryDelete(diaryId, target);
    }
    return fail("未找到接口", 404);
}

export async function handleMeDiaries(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 2 && segments[1] === "preview") {
        return handleDiaryPreview(context, access);
    }

    if (segments.length === 1) {
        if (context.request.method === "GET") {
            return handleDiaryListGet(context, access);
        }
        if (context.request.method === "POST") {
            return handleDiaryCreate(context, access);
        }
    }

    if (segments.length === 2) {
        const identifier = parseRouteId(segments[1]);
        if (!identifier) {
            return fail("缺少日记 ID", 400);
        }
        return handleSingleDiary(context, access, identifier);
    }

    return fail("未找到接口", 404);
}

// ── handleMeDiaryImages 辅助函数 ──────────────────────────────────────────────

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
            created.is_public && diary.praviate === true ? "public" : "private",
        );
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("home-feed"),
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
    const { payload, body, prevFileId, nextFileId } =
        await buildDiaryImagePatchPayload(context);
    const updated = await updateOne("app_diary_images", imageId, payload);
    if (hasOwn(body, "file_id") && nextFileId) {
        await bindFileOwnerToUser(
            nextFileId,
            access.user.id,
            buildDiaryFileTitle(diary.short_id, updated.sort),
            (updated.is_public ?? image.is_public) && diary.praviate === true
                ? "public"
                : "private",
        );
    }
    if (hasOwn(body, "file_id") && prevFileId && prevFileId !== nextFileId) {
        await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [prevFileId],
            ownerUserIds: [String(diary.author_id ?? access.user.id)],
        });
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("home-feed"),
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
    const fileId = normalizeDirectusFileId(image.file_id);
    await deleteOne("app_diary_images", imageId);
    if (fileId) {
        await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [fileId],
            ownerUserIds: [String(diary.author_id ?? "")],
        });
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("home-feed"),
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
        return handleDiaryImagePatch(
            context,
            access,
            imageId,
            image as JsonObject,
            diary as JsonObject,
        );
    }
    if (context.request.method === "DELETE") {
        return handleDiaryImageDelete(
            imageId,
            image as JsonObject,
            diary as JsonObject,
        );
    }
    return fail("未找到接口", 404);
}

export async function handleMeDiaryImages(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 3 && context.request.method === "POST") {
        return handleDiaryImageCreate(context, access, segments);
    }

    if (segments.length === 4) {
        const imageId = parseRouteId(segments[3]);
        if (!imageId) {
            return fail("缺少图片 ID", 400);
        }
        return handleSingleDiaryImage(context, access, imageId);
    }

    return fail("未找到接口", 404);
}
