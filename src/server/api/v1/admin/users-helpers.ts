import type { JsonObject } from "@/types/json";
import {
    loadReferencedFilesByUserFromRepository,
    updateItemsByFilter,
    updateManagedFileMetadata,
    updateRegistrationRequestAvatar,
} from "@/server/repositories/files/file-metadata.repository";

const USER_DELETE_NULLIFY_REFERENCES: Array<{
    collection: string;
    field: string;
}> = [
    { collection: "directus_notifications", field: "sender" },
    { collection: "directus_versions", field: "user_updated" },
    { collection: "directus_comments", field: "user_updated" },
    { collection: "app_site_settings", field: "user_created" },
    { collection: "app_site_settings", field: "user_updated" },
    { collection: "app_site_announcements", field: "user_created" },
    { collection: "app_site_announcements", field: "user_updated" },
    { collection: "app_diary_likes", field: "user_created" },
    { collection: "app_diary_likes", field: "user_updated" },
    { collection: "ai_prompts", field: "user_created" },
    { collection: "ai_prompts", field: "user_updated" },
];

async function nullifyUserReferenceField(
    collection: string,
    field: string,
    userId: string,
): Promise<void> {
    try {
        await updateItemsByFilter({
            collection,
            filter: { [field]: { _eq: userId } } as JsonObject,
            data: { [field]: null } as JsonObject,
        });
    } catch (error) {
        const message = String(error);
        if (
            message.includes("COLLECTION_NOT_FOUND") ||
            message.includes("ITEM_NOT_FOUND") ||
            message.includes("404")
        ) {
            return;
        }
        throw error;
    }
}

export async function clearBlockingUserReferences(
    userId: string,
): Promise<void> {
    for (const target of USER_DELETE_NULLIFY_REFERENCES) {
        await nullifyUserReferenceField(
            target.collection,
            target.field,
            userId,
        );
    }
}

type ReferencedFile = {
    id: string;
    uploaded_by?: unknown;
    modified_by?: unknown;
    app_owner_user_id?: unknown;
};

export async function nullifyReferencedFileOwnership(
    referencedFiles: ReferencedFile[],
    userId: string,
): Promise<void> {
    for (const file of referencedFiles) {
        const payload: {
            uploaded_by?: null;
            modified_by?: null;
            app_owner_user_id?: null;
        } = {};
        if (String(file.uploaded_by || "").trim() === userId) {
            payload.uploaded_by = null;
        }
        if (String(file.modified_by || "").trim() === userId) {
            payload.modified_by = null;
        }
        if (String(file.app_owner_user_id || "").trim() === userId) {
            payload.app_owner_user_id = null;
        }
        if (Object.keys(payload).length === 0) {
            continue;
        }
        try {
            await updateManagedFileMetadata(file.id, payload as JsonObject);
        } catch (error) {
            const message = String(error);
            if (payload.uploaded_by === null && payload.modified_by === null) {
                try {
                    await updateManagedFileMetadata(file.id, {
                        uploaded_by: null,
                    } as JsonObject);
                    continue;
                } catch (fallbackError) {
                    console.warn(
                        `[admin/users] skip file cleanup ${file.id}:`,
                        String(fallbackError),
                    );
                    continue;
                }
            }
            console.warn(
                `[admin/users] skip file cleanup ${file.id}:`,
                message,
            );
        }
    }
}

export async function loadReferencedFilesByUser(
    userId: string,
): Promise<ReferencedFile[]> {
    return loadReferencedFilesByUserFromRepository(userId).catch((error) => {
        const message = String(error);
        if (/forbidden|permission/i.test(message)) {
            console.warn(
                "[admin/users] skip read referenced directus_files due to permission:",
                message,
            );
            return [];
        }
        throw error;
    });
}

export async function nullifyRegistrationRequestAvatars(
    registrationRequests: Array<{ id: string; avatar_file?: unknown }>,
): Promise<void> {
    for (const request of registrationRequests) {
        if (!request.avatar_file) continue;
        await updateRegistrationRequestAvatar(request.id).catch((error) => {
            console.warn(
                "[admin/users] 清空注册请求头像引用失败, requestId:",
                request.id,
                error,
            );
        });
    }
}
