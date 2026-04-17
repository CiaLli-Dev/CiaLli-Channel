import type { APIContext } from "astro";

import { fail, ok } from "@/server/api/response";
import { parsePagination } from "@/server/api/utils";
import { getSessionAccessToken, getSessionUser } from "@/server/auth/session";
import type { BangumiCollectionStatus } from "@/server/bangumi/types";
import {
    withPublicRepositoryContext,
    withUserRepositoryContext,
} from "@/server/repositories/directus/scope";

import {
    loadUserAlbumDetail,
    loadUserAlbumList,
    loadUserBangumiList,
    loadUserDiaryDetail,
    loadUserDiaryList,
    loadUserHomeData,
    type ContentLoadResult,
} from "../public-data";
import { parseRouteId } from "../shared";

type ModuleKey = "home" | "bangumi" | "diary" | "albums";
const USER_HOME_PUBLIC_EDGE_CACHE_CONTROL =
    "public, s-maxage=60, stale-while-revalidate=300";

const VALID_MODULE_KEYS: ReadonlySet<string> = new Set<ModuleKey>([
    "home",
    "bangumi",
    "diary",
    "albums",
]);

function statusFromQuery(value: string): BangumiCollectionStatus | undefined {
    switch (value) {
        case "planned":
        case "completed":
        case "watching":
        case "onhold":
        case "dropped":
            return value;
        default:
            return undefined;
    }
}

function failFromLoadResult(result: ContentLoadResult<unknown>): Response {
    if (result.status === "ok") {
        return fail("未找到接口", 404);
    }
    // 统一 404，避免通过状态码或文案判断资源存在性。
    return fail("资源不存在", 404);
}

async function handleHomeModule(username: string): Promise<Response> {
    const result = await loadUserHomeData(username);
    if (result.status !== "ok") {
        return failFromLoadResult(result);
    }
    return ok(result.data);
}

async function handleBangumiModule(
    context: APIContext,
    username: string,
    detailId: string,
): Promise<Response> {
    if (detailId) {
        return fail("未找到接口", 404);
    }
    const { page, limit } = parsePagination(context.url);
    const status = statusFromQuery(
        context.url.searchParams.get("status")?.trim() || "",
    );
    const result = await loadUserBangumiList(username, {
        page,
        limit,
        status,
    });
    if (result.status !== "ok") {
        return failFromLoadResult(result);
    }
    return ok(result.data);
}

async function handleDiaryDetail(
    username: string,
    detailId: string,
    viewerId: string | null,
): Promise<Response> {
    const result = await loadUserDiaryDetail(username, detailId, { viewerId });
    if (result.status !== "ok") {
        return failFromLoadResult(result);
    }
    return ok({ item: result.data });
}

async function handleDiaryList(
    context: APIContext,
    username: string,
): Promise<Response> {
    const { page, limit } = parsePagination(context.url);
    const result = await loadUserDiaryList(username, { page, limit });
    if (result.status !== "ok") {
        return failFromLoadResult(result);
    }
    return ok(result.data);
}

async function handleDiaryModule(
    context: APIContext,
    username: string,
    detailId: string,
    viewerId: string | null,
): Promise<Response> {
    if (detailId) {
        return handleDiaryDetail(username, detailId, viewerId);
    }
    return handleDiaryList(context, username);
}

async function handleAlbumDetail(
    username: string,
    detailId: string,
    viewerId: string | null,
): Promise<Response> {
    const result = await loadUserAlbumDetail(username, detailId, { viewerId });
    if (result.status !== "ok") {
        return failFromLoadResult(result);
    }
    return ok({ item: result.data });
}

async function handleAlbumList(
    context: APIContext,
    username: string,
): Promise<Response> {
    const { page, limit } = parsePagination(context.url);
    const result = await loadUserAlbumList(username, { page, limit });
    if (result.status !== "ok") {
        return failFromLoadResult(result);
    }
    return ok(result.data);
}

async function handleAlbumsModule(
    context: APIContext,
    username: string,
    detailId: string,
    viewerId: string | null,
): Promise<Response> {
    if (detailId) {
        return handleAlbumDetail(username, detailId, viewerId);
    }
    return handleAlbumList(context, username);
}

async function dispatchModule(
    context: APIContext,
    moduleKey: ModuleKey,
    username: string,
    detailId: string,
    viewerId: string | null,
): Promise<Response> {
    if (moduleKey === "home") {
        return handleHomeModule(username);
    }
    if (moduleKey === "bangumi") {
        return handleBangumiModule(context, username, detailId);
    }
    if (moduleKey === "diary") {
        return detailId
            ? handleDiaryModule(context, username, detailId, viewerId)
            : handleDiaryList(context, username);
    }
    return detailId
        ? handleAlbumsModule(context, username, detailId, viewerId)
        : handleAlbumList(context, username);
}

function applyUserHomeCachePolicy(
    isPublicSnapshot: boolean,
    viewerId: string | null,
    response: Response,
): Response {
    if (!isPublicSnapshot && viewerId) {
        response.headers.set("Cache-Control", "private, no-store");
        return response;
    }
    if (response.ok && !response.headers.has("Cache-Control")) {
        response.headers.set(
            "Cache-Control",
            USER_HOME_PUBLIC_EDGE_CACHE_CONTROL,
        );
    }
    return response;
}

function parseUserHomeRequest(segments: string[]): {
    username: string;
    moduleKey: ModuleKey;
    detailId: string;
} | null {
    if (segments.length < 3 || segments.length > 4) {
        return null;
    }

    const username = parseRouteId(segments[1]);
    if (!username) {
        return null;
    }

    const moduleKey = segments[2];
    if (!VALID_MODULE_KEYS.has(moduleKey)) {
        return null;
    }
    if (moduleKey === "home" && segments.length !== 3) {
        return null;
    }

    const rawDetailId = segments.length === 4 ? parseRouteId(segments[3]) : "";
    if (segments.length === 4 && !rawDetailId) {
        return {
            username,
            moduleKey: moduleKey as ModuleKey,
            detailId: "__invalid__",
        };
    }

    return {
        username,
        moduleKey: moduleKey as ModuleKey,
        detailId: rawDetailId ?? "",
    };
}

function isPublicSnapshotRequest(
    moduleKey: ModuleKey,
    detailId: string,
): boolean {
    return (
        moduleKey === "home" ||
        moduleKey === "bangumi" ||
        (moduleKey === "diary" && !detailId) ||
        (moduleKey === "albums" && !detailId)
    );
}

async function dispatchUserHomeWithContext(params: {
    context: APIContext;
    username: string;
    moduleKey: ModuleKey;
    detailId: string;
    viewerId: string | null;
    isPublicSnapshot: boolean;
}): Promise<Response> {
    if (!params.isPublicSnapshot && params.viewerId) {
        return withUserRepositoryContext(
            getSessionAccessToken(params.context),
            async () =>
                await dispatchModule(
                    params.context,
                    params.moduleKey,
                    params.username,
                    params.detailId,
                    params.viewerId,
                ),
        );
    }

    return withPublicRepositoryContext(async () =>
        dispatchModule(
            params.context,
            params.moduleKey,
            params.username,
            params.detailId,
            params.viewerId,
        ),
    );
}

export async function handleUserHome(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    const request = parseUserHomeRequest(segments);
    if (!request) {
        if (!parseRouteId(segments[1])) {
            return fail("缺少用户名", 400);
        }
        return fail("未找到接口", 404);
    }
    if (request.detailId === "__invalid__") {
        return fail("缺少内容 ID", 400);
    }

    const { detailId, moduleKey, username } = request;
    const isPublicSnapshot = isPublicSnapshotRequest(moduleKey, detailId);
    const sessionUser = isPublicSnapshot ? null : await getSessionUser(context);
    const viewerId = sessionUser?.id ?? null;

    const response = await dispatchUserHomeWithContext({
        context,
        username,
        moduleKey,
        detailId,
        viewerId,
        isPublicSnapshot,
    });
    return applyUserHomeCachePolicy(isPublicSnapshot, viewerId, response);
}
