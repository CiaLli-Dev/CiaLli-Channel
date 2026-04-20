import type { ArticleInteractionSnapshot } from "@/server/repositories/article/interaction.repository";
import type { AuthorBundleItem } from "@/server/api/v1/shared/author-cache";
import type { DetailPageCacheScope } from "@/server/application/public/detail-page-access.service";
import type { DetailPageMode } from "@/server/application/public/detail-page-access.service";
import {
    DETAIL_PAGE_PRIVATE_CACHE_CONTROL,
    DETAIL_PAGE_PUBLIC_CACHE_CONTROL,
    resolveDetailPageAccess,
    resolveDetailPageCacheControl,
} from "@/server/application/public/detail-page-access.service";
import type { AppArticle, AppProfileView } from "@/types/app";

export const ARTICLE_DETAIL_PUBLIC_CACHE_CONTROL =
    DETAIL_PAGE_PUBLIC_CACHE_CONTROL;
export const ARTICLE_DETAIL_PRIVATE_CACHE_CONTROL =
    DETAIL_PAGE_PRIVATE_CACHE_CONTROL;

type SessionUser = {
    id: string;
};

export type ArticleDetailMode = DetailPageMode;

export type ArticleDetailRouteResolution =
    | {
          mode: ArticleDetailMode;
          cacheScope: DetailPageCacheScope;
          article: AppArticle;
          sessionUserId: string | null;
      }
    | {
          mode: "not_found";
          cacheScope: DetailPageCacheScope;
          sessionUserId: string | null;
      };

type ResolveArticleDetailRouteInput = {
    routeId: string;
    preferOwner?: boolean;
    loadPublicArticleByRoute: (routeId: string) => Promise<AppArticle | null>;
    loadSessionUser: () => Promise<SessionUser | null>;
    getSessionAccessToken: () => string;
    loadOwnerArticleByRoute: (
        routeId: string,
        accessToken: string,
    ) => Promise<AppArticle | null>;
};

export async function resolveArticleDetailRoute(
    input: ResolveArticleDetailRouteInput,
): Promise<ArticleDetailRouteResolution> {
    const result = await resolveDetailPageAccess({
        routeId: input.routeId,
        preferOwner: input.preferOwner,
        loadPublicDetail: input.loadPublicArticleByRoute,
        loadSessionUser: input.loadSessionUser,
        getSessionAccessToken: input.getSessionAccessToken,
        loadOwnerDetail: async (routeId, accessToken) =>
            await input.loadOwnerArticleByRoute(routeId, accessToken),
    });

    if (result.mode === "not_found") {
        return result;
    }

    return {
        mode: result.mode,
        cacheScope: result.cacheScope,
        article: result.detail,
        sessionUserId: result.sessionUserId,
    };
}

export function resolveArticleDetailCacheControl(input: {
    responseStatus: number;
    cacheScope: DetailPageCacheScope;
}): string | null {
    return resolveDetailPageCacheControl(input);
}

type LoadArticleDetailViewDataInput = {
    article: AppArticle;
    mode: ArticleDetailMode;
    sessionUserId: string | null;
    loadAuthorBundle: (
        authorId: string,
    ) => Promise<Map<string, AuthorBundleItem>>;
    loadArticleInteractionSnapshot: (input: {
        articleId: string;
        viewerId?: string | null;
    }) => Promise<ArticleInteractionSnapshot>;
    loadPublicProfileByUserId: (
        userId: string,
    ) => Promise<AppProfileView | null>;
    loadProfileForViewerByUserId: (
        userId: string,
        viewerId?: string | null,
    ) => Promise<AppProfileView | null>;
    renderArticleMarkdown: (bodyMarkdown: string) => Promise<string>;
};

export type ArticleDetailViewData = {
    authorMap: Map<string, AuthorBundleItem>;
    interaction: ArticleInteractionSnapshot;
    authorProfile: AppProfileView | null;
    articleHtml: string;
    encryptedBody: string;
    isEncryptedBody: boolean;
    isPubliclyVisible: boolean;
};

export async function loadArticleDetailViewData(
    input: LoadArticleDetailViewDataInput,
): Promise<ArticleDetailViewData> {
    const rawBodyMarkdown = String(input.article.body_markdown || "");
    const isEncryptedBody = rawBodyMarkdown.trim().startsWith("CL2:");
    const isPubliclyVisible =
        input.article.status === "published" &&
        input.article.is_public === true;

    // 公开 SSR 只能读取公共快照；owner fallback 才允许读取 viewer-aware 资料。
    const authorProfilePromise =
        input.mode === "public"
            ? input.loadPublicProfileByUserId(input.article.author_id)
            : input.loadProfileForViewerByUserId(
                  input.article.author_id,
                  input.sessionUserId,
              );

    const [authorMap, interaction, authorProfile, articleHtml] =
        await Promise.all([
            input.loadAuthorBundle(input.article.author_id),
            isPubliclyVisible
                ? input.loadArticleInteractionSnapshot({
                      articleId: input.article.id,
                      viewerId:
                          input.mode === "owner" ? input.sessionUserId : null,
                  })
                : Promise.resolve({
                      likeCount: 0,
                      commentCount: 0,
                      viewerLiked: false,
                  } satisfies ArticleInteractionSnapshot),
            authorProfilePromise,
            isEncryptedBody
                ? Promise.resolve("")
                : input.renderArticleMarkdown(rawBodyMarkdown),
        ]);

    return {
        authorMap,
        interaction,
        authorProfile,
        articleHtml,
        encryptedBody: isEncryptedBody ? rawBodyMarkdown.trim() : "",
        isEncryptedBody,
        isPubliclyVisible,
    };
}
