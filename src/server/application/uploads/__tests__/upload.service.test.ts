import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";

const mocks = vi.hoisted(() => ({
    assertCan: vi.fn(),
    sanitizeImage: vi.fn(),
    uploadManagedFile: vi.fn(),
    validateFileMagicBytes: vi.fn(),
    validateImageDimensions: vi.fn(),
}));

vi.mock("@/server/auth/acl", () => ({
    assertCan: mocks.assertCan,
}));

vi.mock("@/server/security/image-sanitize", () => ({
    sanitizeImage: mocks.sanitizeImage,
}));

vi.mock("@/server/repositories/uploads/upload.repository", () => ({
    uploadManagedFile: mocks.uploadManagedFile,
}));

vi.mock("@/server/security/file-validation", () => ({
    validateFileMagicBytes: mocks.validateFileMagicBytes,
    validateImageDimensions: mocks.validateImageDimensions,
}));

import { createManagedUpload } from "@/server/application/uploads/upload.service";

describe("upload.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.validateFileMagicBytes.mockReturnValue({
            valid: true,
            detectedMime: "image/png",
        });
        mocks.validateImageDimensions.mockResolvedValue({ valid: true });
        mocks.sanitizeImage.mockImplementation(
            async (buffer: Buffer) => buffer,
        );
        mocks.uploadManagedFile.mockResolvedValue({
            id: "file-1",
            title: "test",
            filename_download: "avatar.png",
        });
    });

    it("rejects uploads when the sanitized output exceeds the purpose limit", async () => {
        const originalBuffer = Buffer.alloc(1024);
        const sanitizedBuffer = Buffer.alloc(2 * 1024 * 1024);
        mocks.sanitizeImage.mockResolvedValue(sanitizedBuffer);

        const response = await createManagedUpload({
            authorization: {
                purpose: "avatar",
                ownerUserId: "user-1",
                access: createMemberAccess(),
                accessToken: "token-1",
            },
            file: new File([originalBuffer], "avatar.png", {
                type: "image/png",
            }),
            targetFormat: "png",
            requestedTitle: "avatar",
        });

        expect(response).toBeInstanceOf(Response);
        if (!(response instanceof Response)) {
            throw new Error("expected a Response");
        }

        expect(response.status).toBe(413);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            error: {
                code: "UPLOAD_FILE_TOO_LARGE",
                message: "处理后的文件过大，最大允许 1.5 MB",
            },
        });
        expect(mocks.uploadManagedFile).not.toHaveBeenCalled();
    });

    it("rejects uploads when the original file exceeds the purpose limit", async () => {
        const response = await createManagedUpload({
            authorization: {
                purpose: "avatar",
                ownerUserId: "user-1",
                access: createMemberAccess(),
                accessToken: "token-1",
            },
            file: new File([Buffer.alloc(2 * 1024 * 1024)], "avatar.png", {
                type: "image/png",
            }),
            targetFormat: "png",
            requestedTitle: "avatar",
        });

        expect(response).toBeInstanceOf(Response);
        if (!(response instanceof Response)) {
            throw new Error("expected a Response");
        }

        expect(response.status).toBe(413);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            error: {
                code: "UPLOAD_FILE_TOO_LARGE",
                message: "文件过大，最大允许 1.5 MB",
            },
        });
        expect(mocks.validateFileMagicBytes).not.toHaveBeenCalled();
        expect(mocks.uploadManagedFile).not.toHaveBeenCalled();
    });
});
