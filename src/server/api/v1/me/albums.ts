import type { APIContext } from "astro";

import {
    handleMyAlbumPhotos,
    handleMyAlbums,
} from "@/server/application/me/albums.service";

import type { AppAccess } from "../shared";

export async function handleMeAlbumPhotos(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyAlbumPhotos(context, access, segments);
}

export async function handleMeAlbums(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    return await handleMyAlbums(context, access, segments);
}
