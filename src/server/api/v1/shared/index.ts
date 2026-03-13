// 统一 re-export，保持 `from "./shared"` 导入兼容

export {
    DEFAULT_LIST_LIMIT,
    ADMIN_MODULE_COLLECTION,
    ARTICLE_FIELDS,
    FRIEND_FIELDS,
    DIARY_FIELDS,
} from "./constants";

export type {
    AdminModuleKey,
    AppAccess,
    CommentRecord,
    CommentTreeNode,
} from "./types";

export { isWriteMethod, assertSameOrigin, parseSegments } from "./routing";

export {
    normalizeStatus,
    normalizeAppRole,
    normalizeWatchStatus,
    normalizeAlbumLayout,
    normalizeCommentStatus,
    normalizeRegistrationRequestStatus,
} from "./normalize";

export {
    nowIso,
    sanitizeSlug,
    isSpecialArticleSlug,
    toSpecialArticleSlug,
    excludeSpecialArticleSlugFilter,
    safeCsv,
    hasOwn,
    toDirectusAssetQuery,
} from "./helpers";

export { requireAccess, requireAdmin, filterPublicStatus } from "./auth";

export {
    parseRouteId,
    parseBodyTextField,
    parseProfileBioField,
    parseProfileTypewriterSpeedField,
    parseSocialLinks,
    parseBodyStatus,
    parseBodyCommentStatus,
    parseVisibilityPatch,
} from "./parse";

export {
    loadPublicArticleById,
    loadPublicArticleBySlug,
    loadPublicFriends,
    loadArticleBySlugLoose,
    loadPublicArticleByShortId,
    loadArticleByShortIdLoose,
    loadPublicDiaryById,
    loadPublicDiaryByShortId,
    loadPublicAlbumById,
    loadPublicAlbumByShortId,
    ensureUsernameAvailable,
} from "./loaders";

export { buildCommentTree } from "./comments";

export {
    loadArticleInteractionSnapshot,
    invalidateArticleInteractionAggregate,
    invalidateArticleInteractionViewerState,
} from "./article-interaction";
