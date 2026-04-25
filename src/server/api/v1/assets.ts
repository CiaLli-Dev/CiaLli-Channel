import type { APIContext } from "astro";

import { readDirectusAssetResponse } from "@/server/directus/client";
import { AppError } from "@/server/api/errors";
import { fail } from "@/server/api/response";
import {
    withPublicRepositoryContext,
    withUserRepositoryContext,
} from "@/server/repositories/directus/scope";

import { requireAccess } from "./shared/auth";
import { toDirectusAssetQuery } from "./shared/helpers";
import { parseRouteId } from "./shared/parse";

function buildResponseHeaders(upstreamResponse: Response): Headers {
    const headers = new Headers();
    const contentType = upstreamResponse.headers.get("content-type");
    const contentLength = upstreamResponse.headers.get("content-length");
    const cacheControl = upstreamResponse.headers.get("cache-control");
    const etag = upstreamResponse.headers.get("etag");
    const lastModified = upstreamResponse.headers.get("last-modified");

    if (contentType) {
        headers.set("content-type", contentType);
    }
    if (contentLength) {
        headers.set("content-length", contentLength);
    }
    if (etag) {
        headers.set("etag", etag);
    }
    if (lastModified) {
        headers.set("last-modified", lastModified);
    }
    headers.set("cache-control", cacheControl || "private, max-age=300");
    return headers;
}

export async function handleAuthenticatedAsset(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }
    if (segments.length !== 2) {
        return fail("资源不存在", 404);
    }

    const fileId = parseRouteId(segments[1]);
    if (!fileId) {
        return fail("缺少文件 ID", 400);
    }

    const required = await requireAccess(context);
    const loadAssetResponse = async (): Promise<Response> =>
        await readDirectusAssetResponse({
            fileId,
            query: toDirectusAssetQuery(context.url.searchParams),
        });

    try {
        const response =
            "response" in required
                ? await withPublicRepositoryContext(loadAssetResponse)
                : await withUserRepositoryContext(
                      required.accessToken,
                      loadAssetResponse,
                  );
        if (!response.ok) {
            if (response.status === 403 || response.status === 404) {
                return fail("资源不存在", 404);
            }
            return fail("资源获取失败", response.status);
        }
        return new Response(response.body, {
            status: 200,
            headers: buildResponseHeaders(response),
        });
    } catch (error) {
        if (
            error instanceof AppError &&
            (error.status === 403 || error.status === 404)
        ) {
            return fail("资源不存在", 404);
        }
        throw error;
    }
}
