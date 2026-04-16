import type {
    AppAlbum,
    AppAlbumPhoto,
    AppArticle,
    AppArticleComment,
    AppArticleCommentLike,
    AppArticleLike,
    AppDiary,
    AppDiaryComment,
    AppDiaryCommentLike,
    AppDiaryLike,
    AppDiaryImage,
    AppFile,
    AppFriend,
    AppProfile,
    AppUserRegistrationRequest,
    AppUser,
} from "@/types/app";
import type {
    AppSiteAnnouncement,
    AppSiteSettings,
} from "@/types/site-settings";

export type DirectusSchema = {
    app_user_profiles: AppProfile[];
    app_articles: AppArticle[];
    app_article_comments: AppArticleComment[];
    app_article_comment_likes: AppArticleCommentLike[];
    app_article_likes: AppArticleLike[];
    app_diaries: AppDiary[];
    app_diary_images: AppDiaryImage[];
    app_diary_comments: AppDiaryComment[];
    app_diary_comment_likes: AppDiaryCommentLike[];
    app_diary_likes: AppDiaryLike[];
    app_albums: AppAlbum[];
    app_album_photos: AppAlbumPhoto[];
    app_friends: AppFriend[];
    app_user_registration_requests: AppUserRegistrationRequest[];
    app_site_settings: AppSiteSettings[];
    app_site_announcements: AppSiteAnnouncement[];
    directus_users: AppUser[];
    directus_files: AppFile[];
};
