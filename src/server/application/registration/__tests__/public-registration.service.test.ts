import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createManagedUpload: vi.fn(),
    loadDirectusAccessRegistry: vi.fn(),
    normalizeRequestedUsername: vi.fn((value: string) => value),
    validateDisplayName: vi.fn((value: string) => value),
    cancelPendingRegistration: vi.fn(),
    createPendingRegistrationUser: vi.fn(),
    createRegistrationRequestItem: vi.fn(),
    deleteRegistrationAvatarFile: vi.fn(),
    deleteRegistrationRequest: vi.fn(),
    deletePendingRegistrationUser: vi.fn(),
    findPendingRegistrationById: vi.fn(),
    loadRegistrationSnapshot: vi.fn(),
    readRegistrationAvatarAssetResponse: vi.fn(),
    registrationEmailExists: vi.fn(),
    registrationHasPendingConflict: vi.fn(),
    registrationUsernameExists: vi.fn(),
    setRegistrationRequestAvatar: vi.fn(),
}));

vi.mock("@/server/application/uploads/upload.service", () => ({
    createManagedUpload: mocks.createManagedUpload,
}));

vi.mock("@/server/auth/directus-access", () => ({
    DIRECTUS_ROLE_NAME: {
        member: "member",
    },
}));

vi.mock("@/server/auth/directus-registry", () => ({
    loadDirectusAccessRegistry: mocks.loadDirectusAccessRegistry,
}));

vi.mock("@/server/auth/username", () => ({
    normalizeRequestedUsername: mocks.normalizeRequestedUsername,
    validateDisplayName: mocks.validateDisplayName,
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    normalizeDirectusFileId: (value: unknown) =>
        String(value || "").trim() || null,
}));

vi.mock(
    "@/server/repositories/registration/public-registration.repository",
    () => ({
        cancelPendingRegistration: mocks.cancelPendingRegistration,
        createPendingRegistrationUser: mocks.createPendingRegistrationUser,
        createRegistrationRequestItem: mocks.createRegistrationRequestItem,
        deleteRegistrationAvatarFile: mocks.deleteRegistrationAvatarFile,
        deleteRegistrationRequest: mocks.deleteRegistrationRequest,
        deletePendingRegistrationUser: mocks.deletePendingRegistrationUser,
        findPendingRegistrationById: mocks.findPendingRegistrationById,
        loadRegistrationSnapshot: mocks.loadRegistrationSnapshot,
        readRegistrationAvatarAssetResponse:
            mocks.readRegistrationAvatarAssetResponse,
        registrationEmailExists: mocks.registrationEmailExists,
        registrationHasPendingConflict: mocks.registrationHasPendingConflict,
        registrationUsernameExists: mocks.registrationUsernameExists,
        setRegistrationRequestAvatar: mocks.setRegistrationRequestAvatar,
    }),
);

import {
    cancelPublicRegistration,
    createPublicRegistration,
    replacePublicRegistrationAvatar,
} from "@/server/application/registration/public-registration.service";

describe("public-registration.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.registrationEmailExists.mockResolvedValue(false);
        mocks.registrationUsernameExists.mockResolvedValue(false);
        mocks.registrationHasPendingConflict.mockResolvedValue(false);
        mocks.loadDirectusAccessRegistry.mockResolvedValue({
            roleIdByName: new Map([["member", "role-member"]]),
        });
        mocks.createPendingRegistrationUser.mockResolvedValue({
            id: "pending-user-1",
        });
        mocks.createRegistrationRequestItem.mockResolvedValue({
            id: "request-1",
            avatar_file: null,
        });
        mocks.setRegistrationRequestAvatar.mockResolvedValue({
            id: "request-1",
            avatar_file: "file-1",
        });
        mocks.cancelPendingRegistration.mockResolvedValue({
            id: "request-1",
            request_status: "cancelled",
            avatar_file: null,
        });
        mocks.deleteRegistrationRequest.mockResolvedValue(undefined);
        mocks.deleteRegistrationAvatarFile.mockResolvedValue(undefined);
        mocks.deletePendingRegistrationUser.mockResolvedValue(undefined);
        mocks.findPendingRegistrationById.mockResolvedValue({
            id: "request-1",
            request_status: "pending",
            pending_user_id: "pending-user-1",
            avatar_file: "file-old",
        });
        mocks.createManagedUpload.mockResolvedValue({
            file: { id: "file-1" },
        });
    });

    it("creates registration without avatar upload when avatar is absent", async () => {
        const result = await createPublicRegistration({
            email: "user@example.com",
            username: "user",
            displayName: "User",
            password: "password1",
            registrationReason: "hello",
            avatar: null,
        });

        expect(result).toMatchObject({ id: "request-1", avatar_file: null });
        expect(mocks.createManagedUpload).not.toHaveBeenCalled();
        expect(mocks.setRegistrationRequestAvatar).not.toHaveBeenCalled();
    });

    it("uploads avatar after request creation and binds it to the request", async () => {
        const avatar = new File(["avatar"], "avatar.jpg", {
            type: "image/jpeg",
        });

        const result = await createPublicRegistration({
            email: "user@example.com",
            username: "user",
            displayName: "User",
            password: "password1",
            registrationReason: "hello",
            avatar,
        });

        expect(mocks.createManagedUpload).toHaveBeenCalledWith(
            expect.objectContaining({
                authorization: {
                    purpose: "registration-avatar",
                    ownerUserId: null,
                },
                requestedTitle: "",
            }),
        );
        expect(mocks.setRegistrationRequestAvatar).toHaveBeenCalledWith({
            requestId: "request-1",
            avatarFileId: "file-1",
        });
        expect(result).toMatchObject({
            id: "request-1",
            avatar_file: "file-1",
        });
    });

    it("cleans up request and pending user when avatar attach fails", async () => {
        mocks.setRegistrationRequestAvatar.mockRejectedValue(
            new Error("attach failed"),
        );

        const avatar = new File(["avatar"], "avatar.jpg", {
            type: "image/jpeg",
        });

        await expect(
            createPublicRegistration({
                email: "user@example.com",
                username: "user",
                displayName: "User",
                password: "password1",
                registrationReason: "hello",
                avatar,
            }),
        ).rejects.toThrow("attach failed");

        expect(mocks.deleteRegistrationRequest).toHaveBeenCalledWith(
            "request-1",
        );
        expect(mocks.deleteRegistrationAvatarFile).not.toHaveBeenCalled();
        expect(mocks.deletePendingRegistrationUser).toHaveBeenCalledWith(
            "pending-user-1",
        );
    });

    it("cancels registration without deleting the bound avatar file inline", async () => {
        await cancelPublicRegistration({
            requestId: "request-1",
            cookieRequestId: "request-1",
        });

        expect(mocks.cancelPendingRegistration).toHaveBeenCalledWith({
            requestId: "request-1",
            reviewedAt: expect.any(String),
        });
        expect(mocks.deleteRegistrationAvatarFile).not.toHaveBeenCalled();
    });

    it("rejects avatar replace when request is not pending or rejected", async () => {
        mocks.findPendingRegistrationById.mockResolvedValue({
            id: "request-1",
            request_status: "cancelled",
            pending_user_id: null,
            avatar_file: null,
        });

        await expect(
            replacePublicRegistrationAvatar({
                requestId: "request-1",
                cookieRequestId: "request-1",
                avatar: new File(["avatar"], "avatar.jpg", {
                    type: "image/jpeg",
                }),
            }),
        ).rejects.toMatchObject({
            code: "REGISTRATION_STATUS_CONFLICT",
            status: 409,
        });
    });
});
