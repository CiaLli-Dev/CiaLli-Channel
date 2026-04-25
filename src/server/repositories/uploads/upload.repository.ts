import type { UploadPurpose } from "@/constants/upload-limits";
import {
    updateDirectusFileMetadata,
    uploadDirectusFile,
} from "@/server/directus/client";
import {
    withServiceRepositoryContext,
    withUserRepositoryContext,
} from "@/server/repositories/directus/scope";

type UploadedFilePayload = {
    id: string;
    title?: string;
    filename_download?: string;
};

function resolveInitialFileVisibility(
    purpose: UploadPurpose,
): "private" | "public" {
    if (purpose === "avatar" || purpose === "registration-avatar") {
        return "private";
    }
    return "public";
}

export async function uploadManagedFile(params: {
    purpose: UploadPurpose;
    file: File;
    title?: string;
    folder?: string;
    ownerUserId: string | null;
    accessToken?: string;
}): Promise<UploadedFilePayload> {
    const uploadTask = async (): Promise<UploadedFilePayload> =>
        await uploadDirectusFile({
            file: params.file,
            title: params.title,
            folder: params.folder,
        });

    const uploaded =
        params.purpose === "registration-avatar"
            ? await withServiceRepositoryContext(uploadTask)
            : await withUserRepositoryContext(
                  String(params.accessToken || ""),
                  uploadTask,
              );

    if (
        uploaded.id &&
        (params.purpose === "registration-avatar" ||
            params.title ||
            params.ownerUserId)
    ) {
        const metadataTask = async (): Promise<void> => {
            await updateDirectusFileMetadata(uploaded.id, {
                title: params.title,
                uploaded_by: params.ownerUserId,
                app_owner_user_id: params.ownerUserId,
                app_upload_purpose: params.purpose,
                app_visibility: resolveInitialFileVisibility(params.purpose),
                app_lifecycle: "temporary",
                app_detached_at: null,
                app_quarantined_at: null,
                app_deleted_at: null,
            });
        };

        if (params.purpose === "registration-avatar") {
            await withServiceRepositoryContext(metadataTask);
        } else {
            await withUserRepositoryContext(
                String(params.accessToken || ""),
                metadataTask,
            );
        }
    }

    return uploaded;
}
