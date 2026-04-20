import type { AuthorBundleItem } from "@/server/api/v1/shared/author-cache";
import type {
    DetailPageAccessResolution,
    DetailPageCacheScope,
    DetailPageMode,
} from "@/server/application/public/detail-page-access.service";
import {
    DETAIL_PAGE_PRIVATE_CACHE_CONTROL,
    DETAIL_PAGE_PUBLIC_CACHE_CONTROL,
    resolveDetailPageAccess,
    resolveDetailPageCacheControl,
} from "@/server/application/public/detail-page-access.service";
import type { AppProfileView } from "@/types/app";

import type { DiaryDetail } from "@/server/api/v1/public-data";
import type { DiaryInteractionSnapshot } from "@/server/repositories/diary/interaction.repository";

type SessionUser = {
    id: string;
};

export type DiaryDetailMode = DetailPageMode;

export type DiaryDetailRouteResolution =
    DetailPageAccessResolution<DiaryDetail>;

type ResolveDiaryDetailRouteInput = {
    routeId: string;
    preferOwner?: boolean;
    loadPublicDiaryByRoute: (routeId: string) => Promise<DiaryDetail | null>;
    loadSessionUser: () => Promise<SessionUser | null>;
    getSessionAccessToken: () => string;
    loadOwnerDiaryByRoute: (
        routeId: string,
        accessToken: string,
        sessionUserId: string,
    ) => Promise<DiaryDetail | null>;
};

export const DIARY_DETAIL_PUBLIC_CACHE_CONTROL =
    DETAIL_PAGE_PUBLIC_CACHE_CONTROL;
export const DIARY_DETAIL_PRIVATE_CACHE_CONTROL =
    DETAIL_PAGE_PRIVATE_CACHE_CONTROL;

export async function resolveDiaryDetailRoute(
    input: ResolveDiaryDetailRouteInput,
): Promise<DiaryDetailRouteResolution> {
    return await resolveDetailPageAccess({
        routeId: input.routeId,
        preferOwner: input.preferOwner,
        loadPublicDetail: input.loadPublicDiaryByRoute,
        loadSessionUser: input.loadSessionUser,
        getSessionAccessToken: input.getSessionAccessToken,
        loadOwnerDetail: input.loadOwnerDiaryByRoute,
    });
}

export function resolveDiaryDetailCacheControl(input: {
    responseStatus: number;
    cacheScope: DetailPageCacheScope;
}): string | null {
    return resolveDetailPageCacheControl(input);
}

type LoadDiaryDetailViewDataInput = {
    diary: DiaryDetail;
    mode: DiaryDetailMode;
    sessionUserId: string | null;
    loadAuthorBundle: (
        authorId: string,
    ) => Promise<Map<string, AuthorBundleItem>>;
    loadDiaryInteractionSnapshot: (input: {
        diaryId: string;
        viewerId?: string | null;
    }) => Promise<DiaryInteractionSnapshot>;
    loadPublicProfileByUserId: (
        userId: string,
    ) => Promise<AppProfileView | null>;
    loadProfileForViewerByUserId: (
        userId: string,
        viewerId?: string | null,
    ) => Promise<AppProfileView | null>;
    renderDiaryMarkdown: (content: string) => Promise<string>;
};

export type { DiaryInteractionSnapshot };

export type DiaryDetailViewData = {
    authorMap: Map<string, AuthorBundleItem>;
    interaction: DiaryInteractionSnapshot;
    authorProfile: AppProfileView | null;
    diaryHtml: string;
    isPubliclyVisible: boolean;
};

export async function loadDiaryDetailViewData(
    input: LoadDiaryDetailViewDataInput,
): Promise<DiaryDetailViewData> {
    const isPubliclyVisible =
        input.diary.status === "published" && input.diary.praviate === true;

    const authorProfilePromise =
        input.mode === "public"
            ? input.loadPublicProfileByUserId(input.diary.author_id)
            : input.loadProfileForViewerByUserId(
                  input.diary.author_id,
                  input.sessionUserId,
              );

    const [authorMap, interaction, authorProfile, diaryHtml] =
        await Promise.all([
            input.loadAuthorBundle(input.diary.author_id),
            isPubliclyVisible
                ? input.loadDiaryInteractionSnapshot({
                      diaryId: input.diary.id,
                      viewerId:
                          input.mode === "owner" ? input.sessionUserId : null,
                  })
                : Promise.resolve({
                      likeCount: 0,
                      commentCount: 0,
                      viewerLiked: false,
                  } satisfies DiaryInteractionSnapshot),
            authorProfilePromise,
            input.renderDiaryMarkdown(input.diary.content),
        ]);

    return {
        authorMap,
        interaction,
        authorProfile,
        diaryHtml,
        isPubliclyVisible,
    };
}
