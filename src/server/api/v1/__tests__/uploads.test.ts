import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";

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
        expect(mocks.requireAccess).not.toHaveBeenCalled();
        expect(mocks.createManagedUpload).not.toHaveBeenCalled();
    });
});
