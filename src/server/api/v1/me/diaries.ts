import type { APIContext } from "astro";
import {
    handleMyDiaries,
    handleMyDiaryImages,
} from "@/server/application/me/diaries.service";

import type { AppAccess } from "../shared/types";

export async function handleMeDiaryImages(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyDiaryImages(context, access, segments);
}

export async function handleMeDiaries(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyDiaries(context, access, segments);
}
