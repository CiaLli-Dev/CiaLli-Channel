import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";
import { AppError } from "@/server/api/errors";

vi.mock("@/server/directus/client", () => ({
    readDirectusAssetResponse: vi.fn(),
}));

import { readDirectusAssetResponse } from "@/server/directus/client";
import { handlePublicAsset } from "@/server/api/v1/public/assets";

const mockedReadDirectusAssetResponse = vi.mocked(readDirectusAssetResponse);

function makeContext(): APIContext {
    return createMockAPIContext({
        method: "GET",
        url: "http://localhost:4321/api/v1/public/assets/test",
        params: { segments: "public/assets/test" },
    }) as unknown as APIContext;
}

describe("handlePublicAsset", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("非 UUID fileId 直接返回 404，且不请求 Directus", async () => {
        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            "localhost",
        ]);

        expect(response.status).toBe(404);
        expect(mockedReadDirectusAssetResponse).not.toHaveBeenCalled();
    });

    it("Directus 403/404 错误统一映射为 404", async () => {
        mockedReadDirectusAssetResponse.mockRejectedValue(
            new AppError("DIRECTUS_FORBIDDEN", "内部错误细节不应外泄", 403),
        );

        const response = await handlePublicAsset(makeContext(), [
            "public",
            "assets",
            "11111111-1111-4111-8111-111111111111",
        ]);

        expect(response.status).toBe(404);
    });
});
