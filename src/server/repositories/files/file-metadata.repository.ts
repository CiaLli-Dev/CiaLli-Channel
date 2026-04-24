import type { JsonObject } from "@/types/json";
import {
    readOneById,
    readMany,
    updateDirectusFileMetadata,
    updateManyItemsByFilter,
    updateOne,
} from "@/server/directus/client";

export type ManagedFileVisibilityRecord = {
    id: string;
    app_visibility?: "private" | "public" | null;
};

export async function readManagedFileVisibility(
    fileId: string,
): Promise<ManagedFileVisibilityRecord | null> {
    return (await readOneById("directus_files", fileId, {
        fields: ["id", "app_visibility"],
    })) as ManagedFileVisibilityRecord | null;
}

export async function updateManagedFileMetadata(
    fileId: string,
    payload: JsonObject,
): Promise<void> {
    await updateDirectusFileMetadata(fileId, payload);
}

export async function updateItemsByFilter(params: {
    collection: string;
    filter: JsonObject;
    data: JsonObject;
}): Promise<void> {
    await updateManyItemsByFilter(params);
}

export async function updateRegistrationRequestAvatar(
    requestId: string,
): Promise<void> {
    await updateOne("app_user_registration_requests", requestId, {
        avatar_file: null,
    });
}

export async function loadReferencedFilesByUserFromRepository(
    userId: string,
): Promise<
    Array<{
        id: string;
        uploaded_by?: unknown;
        modified_by?: unknown;
        app_owner_user_id?: unknown;
    }>
> {
    return await readMany("directus_files", {
        filter: {
            _or: [
                { uploaded_by: { _eq: userId } },
                { modified_by: { _eq: userId } },
                { app_owner_user_id: { _eq: userId } },
            ],
        } as JsonObject,
        limit: 5000,
        fields: ["id", "uploaded_by", "modified_by", "app_owner_user_id"],
    });
}
