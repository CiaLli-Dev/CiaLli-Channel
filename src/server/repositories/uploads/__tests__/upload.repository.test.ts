import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    uploadDirectusFile: vi.fn(),
    updateDirectusFileMetadata: vi.fn(),
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    withUserRepositoryContext: vi.fn(
        async (_token: string, task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/directus/client", () => ({
    uploadDirectusFile: mocks.uploadDirectusFile,
    updateDirectusFileMetadata: mocks.updateDirectusFileMetadata,
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: mocks.withServiceRepositoryContext,
    withUserRepositoryContext: mocks.withUserRepositoryContext,
}));

import { uploadManagedFile } from "@/server/repositories/uploads/upload.repository";

describe("upload.repository", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.uploadDirectusFile.mockResolvedValue({
            id: "file-1",
            title: "title-1",
            filename_download: "file.png",
        });
        mocks.updateDirectusFileMetadata.mockResolvedValue(undefined);
    });

    it("persists app_upload_purpose for registration avatars", async () => {
        const file = new File(["avatar"], "avatar.png", { type: "image/png" });

        await uploadManagedFile({
            purpose: "registration-avatar",
            file,
            ownerUserId: null,
        });

        expect(mocks.withServiceRepositoryContext).toHaveBeenCalledTimes(2);
        expect(mocks.withUserRepositoryContext).not.toHaveBeenCalled();
        expect(mocks.updateDirectusFileMetadata).toHaveBeenCalledWith(
            "file-1",
            expect.objectContaining({
                app_upload_purpose: "registration-avatar",
                app_owner_user_id: null,
                app_visibility: "private",
                app_lifecycle: "temporary",
                app_detached_at: null,
            }),
        );
    });

    it("keeps owner and visibility behavior for authenticated uploads", async () => {
        const file = new File(["cover"], "cover.png", { type: "image/png" });

        await uploadManagedFile({
            purpose: "article-cover",
            file,
            ownerUserId: "user-1",
            accessToken: "access-token",
            title: "Article Cover",
        });

        expect(mocks.withUserRepositoryContext).toHaveBeenCalledTimes(1);
        expect(mocks.withServiceRepositoryContext).toHaveBeenCalledTimes(1);
        expect(mocks.updateDirectusFileMetadata).toHaveBeenCalledWith(
            "file-1",
            expect.objectContaining({
                title: "Article Cover",
                uploaded_by: "user-1",
                app_owner_user_id: "user-1",
                app_upload_purpose: "article-cover",
                app_visibility: "public",
                app_lifecycle: "temporary",
                app_detached_at: null,
            }),
        );
    });
});
