import type { ArticleInteractionSnapshot } from "@/server/repositories/article/interaction.repository";
import type { AuthorBundleItem } from "@/server/api/v1/shared/author-cache";
import type { AppArticle, AppProfileView } from "@/types/app";

export const ARTICLE_DETAIL_PUBLIC_CACHE_CONTROL =
    "public, s-maxage=60, stale-while-revalidate=300";
export const ARTICLE_DETAIL_PRIVATE_CACHE_CONTROL = "private, no-store";

type SessionUser = {
    id: string;
};

export type ArticleDetailMode = "public" | "owner";

export type ArticleDetailRouteResolution =
    | {
          mode: ArticleDetailMode;
          article: AppArticle;
          sessionUserId: string | null;
      }
    | {
          mode: "not_found";
          sessionUserId: string | null;
      };

type ResolveArticleDetailRouteInput = {
    routeId: string;
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
    const publicArticle = await input.loadPublicArticleByRoute(input.routeId);
    if (publicArticle) {
        return {
            mode: "public",
            article: publicArticle,
            sessionUserId: null,
        };
    }

    // 公开内容未命中后才懒加载会话，避免公开详情页因为 cookie 被整体打成私有缓存。
    const sessionUser = await input.loadSessionUser();
    if (!sessionUser) {
        return {
            mode: "not_found",
            sessionUserId: null,
        };
    }

    const accessToken = input.getSessionAccessToken();
    if (!accessToken) {
        return {
            mode: "not_found",
            sessionUserId: sessionUser.id,
        };
    }

    const ownerArticle = await input.loadOwnerArticleByRoute(
        input.routeId,
        accessToken,
    );
    if (!ownerArticle || ownerArticle.author_id !== sessionUser.id) {
        return {
            mode: "not_found",
            sessionUserId: sessionUser.id,
        };
    }

    return {
        mode: "owner",
        article: ownerArticle,
        sessionUserId: sessionUser.id,
    };
}

export function resolveArticleDetailCacheControl(input: {
    responseStatus: number;
    mode: ArticleDetailMode | "not_found" | "error";
}): string | null {
    if (input.responseStatus >= 500) {
        return null;
    }
    if (input.mode === "owner") {
        return ARTICLE_DETAIL_PRIVATE_CACHE_CONTROL;
    }
    return ARTICLE_DETAIL_PUBLIC_CACHE_CONTROL;
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
