import type { AppUserRegistrationRequest } from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    createDirectusUser,
    createOne,
    deleteDirectusFile,
    deleteOne,
    deleteDirectusUser,
    readDirectusAssetResponse,
    readMany,
    updateOne,
} from "@/server/directus/client";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";

export type RegistrationRequestSnapshot = Pick<
    AppUserRegistrationRequest,
    | "id"
    | "email"
    | "username"
    | "display_name"
    | "avatar_file"
    | "registration_reason"
    | "request_status"
    | "approved_user_id"
    | "reviewed_at"
    | "reject_reason"
    | "date_created"
>;

type RegistrationPendingRecord = Pick<
    AppUserRegistrationRequest,
    "id" | "request_status" | "pending_user_id" | "avatar_file"
>;

export async function registrationEmailExists(email: string): Promise<boolean> {
    return await withServiceRepositoryContext(async () => {
        const rows = await readMany("directus_users", {
            filter: { email: { _eq: email } } as JsonObject,
            limit: 1,
            fields: ["id"],
        });
        return rows.length > 0;
    });
}

export async function registrationUsernameExists(
    username: string,
): Promise<boolean> {
    return await withServiceRepositoryContext(async () => {
        const rows = await readMany("app_user_profiles", {
            filter: { username: { _eq: username } } as JsonObject,
            limit: 1,
            fields: ["id"],
        });
        return rows.length > 0;
    });
}

export async function registrationHasPendingConflict(params: {
    email?: string;
    username?: string;
}): Promise<boolean> {
    return await withServiceRepositoryContext(async () => {
        const conflictBranches: JsonObject[] = [];
        if (params.email) {
            conflictBranches.push({ email: { _eq: params.email } });
        }
        if (params.username) {
            conflictBranches.push({ username: { _eq: params.username } });
        }
        if (conflictBranches.length === 0) {
            return false;
        }

        const rows = await readMany("app_user_registration_requests", {
            filter: {
                _and: [
                    { request_status: { _eq: "pending" } },
                    {
                        _or: conflictBranches,
                    },
                ],
            } as JsonObject,
            limit: 1,
            fields: ["id"],
        });
        return rows.length > 0;
    });
}

export async function createPendingRegistrationUser(params: {
    email: string;
    password: string;
    displayName: string;
    memberRoleId: string;
}): Promise<{ id: string }> {
    return await withServiceRepositoryContext(
        async () =>
            await createDirectusUser({
                email: params.email,
                password: params.password,
                first_name: params.displayName || undefined,
                status: "draft",
                role: params.memberRoleId,
                policies: [],
            }),
    );
}

export async function createRegistrationRequestItem(params: {
    email: string;
    username: string;
    displayName: string;
    avatarFile: string | null;
    registrationReason: string;
    pendingUserId: string;
}): Promise<AppUserRegistrationRequest> {
    return await withServiceRepositoryContext(
        async () =>
            await createOne("app_user_registration_requests", {
                status: "published",
                email: params.email,
                username: params.username,
                display_name: params.displayName,
                avatar_file: params.avatarFile,
                registration_reason: params.registrationReason,
                request_status: "pending",
                pending_user_id: params.pendingUserId,
                reviewed_by: null,
                reviewed_at: null,
                reject_reason: null,
                approved_user_id: null,
            }),
    );
}

export async function findPendingRegistrationById(
    requestId: string,
): Promise<RegistrationPendingRecord | null> {
    return await withServiceRepositoryContext(async () => {
        const rows = await readMany("app_user_registration_requests", {
            filter: { id: { _eq: requestId } } as JsonObject,
            limit: 1,
            fields: ["id", "request_status", "pending_user_id", "avatar_file"],
        });
        return (rows[0] as RegistrationPendingRecord | undefined) ?? null;
    });
}

export async function setRegistrationRequestAvatar(params: {
    requestId: string;
    avatarFileId: string | null;
}): Promise<AppUserRegistrationRequest> {
    return await withServiceRepositoryContext(
        async () =>
            await updateOne(
                "app_user_registration_requests",
                params.requestId,
                {
                    avatar_file: params.avatarFileId,
                },
            ),
    );
}

export async function cancelPendingRegistration(params: {
    requestId: string;
    reviewedAt: string;
}): Promise<AppUserRegistrationRequest> {
    return await withServiceRepositoryContext(
        async () =>
            await updateOne(
                "app_user_registration_requests",
                params.requestId,
                {
                    request_status: "cancelled",
                    avatar_file: null,
                    reviewed_by: null,
                    reviewed_at: params.reviewedAt,
                    pending_user_id: null,
                    reject_reason: null,
                },
            ),
    );
}

export async function deletePendingRegistrationUser(
    pendingUserId: string,
): Promise<void> {
    await withServiceRepositoryContext(async () => {
        await deleteDirectusUser(pendingUserId);
    }).catch((error) => {
        console.warn(
            "[registration/repository] delete pending user failed:",
            error,
        );
    });
}

export async function deleteRegistrationRequest(
    requestId: string,
): Promise<void> {
    await withServiceRepositoryContext(async () => {
        await deleteOne("app_user_registration_requests", requestId);
    });
}

export async function deleteRegistrationAvatarFile(
    fileId: string | null | undefined,
): Promise<void> {
    const normalized = String(fileId || "").trim();
    if (!normalized) {
        return;
    }
    await withServiceRepositoryContext(async () => {
        await deleteDirectusFile(normalized);
    });
}

export async function readRegistrationAvatarAssetResponse(params: {
    fileId: string;
    query?: Partial<
        Record<"width" | "height" | "fit" | "quality" | "format", string>
    >;
}): Promise<Response> {
    return await withServiceRepositoryContext(async () => {
        return await readDirectusAssetResponse({
            fileId: params.fileId,
            query: params.query,
        });
    });
}

export async function loadRegistrationSnapshot(
    requestId: string,
): Promise<RegistrationRequestSnapshot | null> {
    return await withServiceRepositoryContext(async () => {
        const rows = await readMany("app_user_registration_requests", {
            filter: { id: { _eq: requestId } } as JsonObject,
            limit: 1,
            fields: [
                "id",
                "email",
                "username",
                "display_name",
                "avatar_file",
                "registration_reason",
                "request_status",
                "approved_user_id",
                "reviewed_at",
                "reject_reason",
                "date_created",
            ],
        });
        return (rows[0] as RegistrationRequestSnapshot | undefined) ?? null;
    });
}
