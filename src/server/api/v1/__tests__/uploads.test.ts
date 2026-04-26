import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

const mocks = vi.hoisted(() => ({
    createManagedUpload: vi.fn(),
    requireAccess: vi.fn(),
}));

vi.mock("@/server/application/uploads/upload.service", () => ({
    createManagedUpload: mocks.createManagedUpload,
    resolveUploadPurpose: vi.fn((value: FormDataEntryValue | null) =>
        typeof value === "string" ? value : "general",
    ),
}));

vi.mock("@/server/api/v1/shared/auth", () => ({
    requireAccess: mocks.requireAccess,
}));

import { handleUploads } from "@/server/api/v1/uploads";

describe("handleUploads", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects registration-avatar uploads through the generic uploads route", async () => {
        const formData = new FormData();
        formData.append(
            "file",
            new File(["avatar"], "avatar.jpg", { type: "image/jpeg" }),
        );
        formData.append("purpose", "registration-avatar");

        const context = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/uploads",
            params: { segments: "uploads" },
            formData,
        }) as unknown as APIContext;

        const response = await handleUploads(context);

        expect(response.status).toBe(400);
        await expect(parseResponseJson(response)).resolves.toMatchObject({
            error: {
                code: "UNSUPPORTED_UPLOAD_PURPOSE",
                message: "不支持的上传用途",
            },
        });
        expect(mocks.requireAccess).not.toHaveBeenCalled();
        expect(mocks.createManagedUpload).not.toHaveBeenCalled();
    });

    it("returns stable error code when upload file is missing", async () => {
        const formData = new FormData();
        formData.append("purpose", "avatar");

        const context = createMockAPIContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/uploads",
            params: { segments: "uploads" },
            formData,
        }) as unknown as APIContext;

        const response = await handleUploads(context);

        expect(response.status).toBe(400);
        await expect(parseResponseJson(response)).resolves.toMatchObject({
            error: {
                code: "UPLOAD_FILE_REQUIRED",
                message: "缺少上传文件",
            },
        });
        expect(mocks.requireAccess).not.toHaveBeenCalled();
        expect(mocks.createManagedUpload).not.toHaveBeenCalled();
    });
});
