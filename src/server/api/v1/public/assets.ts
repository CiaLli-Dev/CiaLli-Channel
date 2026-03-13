import type { APIContext } from "astro";

import { readDirectusAssetResponse } from "@/server/directus/client";
import { AppError } from "@/server/api/errors";
import { fail } from "@/server/api/response";
import { isUuid } from "@/server/utils/short-id";

import { parseRouteId, toDirectusAssetQuery } from "../shared";

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

    // 图片资源使用长缓存（文件 ID 内容寻址，更换文件 = 新 ID）
    const isImage = Boolean(contentType && contentType.startsWith("image/"));
    headers.set(
        "cache-control",
        isImage
            ? "public, max-age=31536000, immutable"
            : cacheControl || "public, max-age=300, s-maxage=300",
    );

    return headers;
}

async function fetchAssetResponse(
    fileId: string,
    searchParams: URLSearchParams,
): Promise<Response | AppError> {
    try {
        return await readDirectusAssetResponse({
            fileId,
            query: toDirectusAssetQuery(searchParams),
        });
    } catch (error) {
        if (
            error instanceof AppError &&
            (error.status === 403 || error.status === 404)
        ) {
            return error;
        }
        throw error;
    }
}

function toNotFoundOnAuthError(_err: AppError): Response {
    return fail("资源不存在", 404);
}

function assertUpstreamOk(response: Response): void {
    if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
            return;
        }
        throw new AppError(
            "ASSET_FETCH_FAILED",
            `资源获取失败: ${response.status} ${response.statusText}`,
            response.status >= 400 && response.status < 500
                ? response.status
                : 502,
        );
    }
}

export async function handlePublicAsset(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    if (segments.length !== 3) {
        return fail("资源不存在", 404);
    }

    const fileId = parseRouteId(segments[2]);
    if (!fileId) {
        return fail("缺少文件 ID", 400);
    }
    if (!isUuid(fileId)) {
        return fail("资源不存在", 404);
    }

    const fetchResult = await fetchAssetResponse(
        fileId,
        context.url.searchParams,
    );

    if (fetchResult instanceof AppError) {
        return toNotFoundOnAuthError(fetchResult);
    }

    const response = fetchResult;
    if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
            return fail("资源不存在", 404);
        }
        assertUpstreamOk(response);
    }

    const headers = buildResponseHeaders(response);

    return new Response(response.body, {
        status: 200,
        headers,
    });
}
