import type { APIContext } from "astro";

import {
    createManagedUpload,
    resolveUploadPurpose,
} from "@/server/application/uploads/upload.service";
import { getSessionUser } from "@/server/auth/session";
import { fail, ok } from "@/server/api/response";

import { requireAccess } from "./shared";

export async function handleUploads(context: APIContext): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }

    const formData = await context.request.formData();
    const purpose = resolveUploadPurpose(formData.get("purpose"));

    const file = formData.get("file");
    if (!(file instanceof File)) {
        return fail("缺少上传文件", 400);
    }

    const targetFormatRaw = formData.get("target_format");
    const targetFormat =
        typeof targetFormatRaw === "string" ? targetFormatRaw : "";
    const titleRaw = formData.get("title");
    const folderRaw = formData.get("folder");
    const requestedTitle = typeof titleRaw === "string" ? titleRaw.trim() : "";

    const result =
        purpose === "registration-avatar"
            ? await createManagedUpload({
                  authorization: {
                      purpose,
                      ownerUserId: (await getSessionUser(context))?.id || null,
                  },
                  file,
                  targetFormat,
                  requestedTitle,
                  folder: typeof folderRaw === "string" ? folderRaw : undefined,
              })
            : await (async () => {
                  const required = await requireAccess(context);
                  if ("response" in required) {
                      return required.response;
                  }
                  return await createManagedUpload({
                      authorization: {
                          purpose,
                          ownerUserId: required.access.user.id,
                          access: required.access,
                          accessToken: required.accessToken,
                      },
                      file,
                      targetFormat,
                      requestedTitle,
                      folder:
                          typeof folderRaw === "string" ? folderRaw : undefined,
                  });
              })();
    if (result instanceof Response) {
        return result;
    }
    return ok(result);
}
