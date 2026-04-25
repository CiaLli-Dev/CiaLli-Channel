import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";
import { AppError } from "@/server/api/errors";

vi.mock("@/server/directus/client", () => ({
    readDirectusAssetResponse: vi.fn(),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/repositories/files/file-metadata.repository", () => ({
    readManagedFileVisibility: vi.fn(),
}));

import { readDirectusAssetResponse } from "@/server/directus/client";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { handlePublicAsset } from "@/server/api/v1/public/assets";
import { readManagedFileVisibility } from "@/server/repositories/files/file-metadata.repository";

const mockedReadDirectusAssetResponse = vi.mocked(readDirectusAssetResponse);
const mockedWithServiceRepositoryContext = vi.mocked(
    withServiceRepositoryContext,
);
const mockedReadManagedFileVisibility = vi.mocked(readManagedFileVisibility);

const PUBLIC_FILE_ID = "11111111-1111-4111-8111-111111111111";

function makeContext(): APIContext {
    return createMockAPIContext({
        method: "GET",
        url: `http://localhost:4321/api/v1/public/assets/${PUBLIC_FILE_ID}?width=120`,
        params: { segments: `public/assets/${PUBLIC_FILE_ID}` },
    }) as unknown as APIContext;
}

describe("handlePublicAsset", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedReadManagedFileVisibility.mockResolvedValue({
            id: PUBLIC_FILE_ID,
            app_visibility: "public",
            app_lifecycle: "attached",
        });
    });

    it("非 UUID fileId 直接返回 404，且不读元数据也不请求 Directus", async () => {
        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            "localhost",
        ]);

        expect(response.status).toBe(404);
        expect(mockedReadManagedFileVisibility).not.toHaveBeenCalled();
        expect(mockedReadDirectusAssetResponse).not.toHaveBeenCalled();
    });

    it("文件不存在时返回 404", async () => {
        mockedReadManagedFileVisibility.mockResolvedValue(null);

        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            PUBLIC_FILE_ID,
        ]);

        expect(response.status).toBe(404);
        expect(mockedReadManagedFileVisibility).toHaveBeenCalledWith(
            PUBLIC_FILE_ID,
        );
        expect(mockedReadDirectusAssetResponse).not.toHaveBeenCalled();
    });

    it("文件元数据读取 403/404 统一映射为公开 404", async () => {
        mockedReadManagedFileVisibility.mockRejectedValue(
            new AppError("DIRECTUS_FORBIDDEN", "内部权限细节不应外泄", 403),
        );

        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            PUBLIC_FILE_ID,
        ]);

        expect(response.status).toBe(404);
        expect(mockedReadDirectusAssetResponse).not.toHaveBeenCalled();
    });

    it("文件元数据读取非权限错误继续抛出", async () => {
        mockedReadManagedFileVisibility.mockRejectedValue(
            new AppError("DIRECTUS_ERROR", "upstream unavailable", 502),
        );

        await expect(
            handlePublicAsset(makeContext(), [
                "public",
                "assets",
                PUBLIC_FILE_ID,
            ]),
        ).rejects.toMatchObject({
            code: "DIRECTUS_ERROR",
            status: 502,
        });
    });

    it("私有文件返回 404，且不请求 Directus asset", async () => {
        mockedReadManagedFileVisibility.mockResolvedValue({
            id: PUBLIC_FILE_ID,
            app_visibility: "private",
            app_lifecycle: "attached",
        });

        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            PUBLIC_FILE_ID,
        ]);

        expect(response.status).toBe(404);
        expect(mockedReadDirectusAssetResponse).not.toHaveBeenCalled();
    });

    it("app_visibility 为空时返回 404，且不请求 Directus asset", async () => {
        mockedReadManagedFileVisibility.mockResolvedValue({
            id: PUBLIC_FILE_ID,
            app_visibility: null,
            app_lifecycle: "attached",
        });

        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            PUBLIC_FILE_ID,
        ]);

        expect(response.status).toBe(404);
        expect(mockedReadDirectusAssetResponse).not.toHaveBeenCalled();
    });

    it("公开但未绑定或待删除生命周期返回 404", async () => {
        for (const lifecycle of [
            "temporary",
            "detached",
            "quarantined",
            "deleted",
        ] as const) {
            mockedReadDirectusAssetResponse.mockClear();
            mockedReadManagedFileVisibility.mockResolvedValue({
                id: PUBLIC_FILE_ID,
                app_visibility: "public",
                app_lifecycle: lifecycle,
            });

            const response = await handlePublicAsset(makeContext(), [
                "public",
                "assets",
                PUBLIC_FILE_ID,
            ]);

            expect(response.status).toBe(404);
            expect(mockedReadDirectusAssetResponse).not.toHaveBeenCalled();
        }
    });

    it("公开文件才请求上游资源，并保留响应头", async () => {
        mockedReadDirectusAssetResponse.mockResolvedValue(
            new Response("image-bytes", {
                status: 200,
                headers: {
                    "content-type": "image/webp",
                    "content-length": "11",
                    etag: '"etag-value"',
                    "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
                },
            }),
        );

        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            PUBLIC_FILE_ID,
        ]);

        expect(response.status).toBe(200);
        expect(mockedWithServiceRepositoryContext).toHaveBeenCalledTimes(2);
        expect(mockedReadManagedFileVisibility).toHaveBeenCalledWith(
            PUBLIC_FILE_ID,
        );
        expect(mockedReadDirectusAssetResponse).toHaveBeenCalledWith({
            fileId: PUBLIC_FILE_ID,
            query: {
                width: "120",
            },
        });
        expect(response.headers.get("content-type")).toBe("image/webp");
        expect(response.headers.get("content-length")).toBe("11");
        expect(response.headers.get("etag")).toBe('"etag-value"');
        expect(response.headers.get("last-modified")).toBe(
            "Wed, 01 Jan 2025 00:00:00 GMT",
        );
        expect(response.headers.get("cache-control")).toBe(
            "public, max-age=31536000, immutable",
        );
    });

    it("Directus 403/404 错误统一映射为 404", async () => {
        mockedReadDirectusAssetResponse.mockRejectedValue(
            new AppError("DIRECTUS_FORBIDDEN", "内部错误细节不应外泄", 403),
        );

        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            PUBLIC_FILE_ID,
        ]);

        expect(response.status).toBe(404);
    });
});
