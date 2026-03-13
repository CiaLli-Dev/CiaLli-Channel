export type AppStatus = "draft" | "published" | "archived";

export type SocialLink = {
    platform: string;
    url: string;
    enabled: boolean;
};

export type CommentStatus = "published" | "hidden" | "archived";

export type AppRole = "admin" | "member";

export type AppPermissionKey =
    | "can_publish_articles"
    | "can_comment_articles"
    | "can_manage_diaries"
    | "can_comment_diaries"
    | "can_manage_albums"
    | "can_upload_files";

export type AppProfile = {
    id: string;
    user_id: string;
    username: string;
    display_name: string;
    bio_typewriter_enable: boolean;
    bio_typewriter_speed: number;
    header_file: string | null;
    profile_public: boolean;
    show_articles_on_profile: boolean;
    show_diaries_on_profile: boolean;
    show_bangumi_on_profile: boolean;
    show_albums_on_profile: boolean;
    show_comments_on_profile: boolean;
    bangumi_username: string | null;
    bangumi_include_private: boolean;
    bangumi_access_token_encrypted: string | null;
    social_links: SocialLink[] | null;
    home_section_order: string[] | null;
    is_official: boolean;
    status: AppStatus;
};

export type AppProfileView = AppProfile & {
    bio: string | null;
    avatar_file: string | null;
};

export type SidebarProfileData = {
    display_name: string;
    bio: string | null;
    bio_typewriter_enable: boolean;
    bio_typewriter_speed: number;
    avatar_url: string | null;
    username: string | null;
    social_links: SocialLink[] | null;
    is_official: boolean;
};

export type AppPermissions = {
    app_role: AppRole;
    can_publish_articles: boolean;
    can_comment_articles: boolean;
    can_manage_diaries: boolean;
    can_comment_diaries: boolean;
    can_manage_albums: boolean;
    can_upload_files: boolean;
};

export type AppArticle = {
    id: string;
    short_id: string | null;
    author_id: string;
    status: AppStatus;
    title: string;
    slug: string | null;
    summary: string | null;
    body_markdown: string;
    cover_file: string | null;
    cover_url: string | null;
    tags: string[] | null;
    category: string | null;
    allow_comments: boolean;
    is_public: boolean;
    date_created: string | null;
    date_updated: string | null;
};

export type AppDiary = {
    id: string;
    short_id: string | null;
    author_id: string;
    status: AppStatus;
    content: string;
    allow_comments: boolean;
    praviate: boolean;
    date_created: string | null;
    date_updated: string | null;
};

export type AppDiaryImage = {
    id: string;
    status: AppStatus;
    diary_id: string;
    file_id: string | null;
    image_url: string | null;
    caption: string | null;
    is_public: boolean;
    show_on_profile: boolean;
    sort: number | null;
    date_created: string | null;
    date_updated: string | null;
};

export type AppFriend = {
    id: string;
    sort: number | null;
    title: string;
    description: string | null;
    site_url: string;
    avatar_file: string | null;
    tags: string[] | null;
    is_public: boolean;
    date_created: string | null;
    date_updated: string | null;
};

export type AppAlbum = {
    id: string;
    short_id: string | null;
    author_id: string;
    status: "published" | "private";
    title: string;
    slug: string;
    description: string | null;
    cover_file: string | null;
    cover_url: string | null;
    date: string | null;
    location: string | null;
    tags: string[] | null;
    category: string | null;
    layout: "grid" | "masonry";
    columns: number;
    is_public: boolean;
    date_created: string | null;
    date_updated: string | null;
};

export type AppAlbumPhoto = {
    id: string;
    status: AppStatus;
    album_id: string;
    file_id: string | null;
    image_url: string | null;
    title: string | null;
    description: string | null;
    tags: string[] | null;
    taken_at: string | null;
    location: string | null;
    is_public: boolean;
    show_on_profile: boolean;
    sort: number | null;
    date_created: string | null;
    date_updated: string | null;
};

export type AppArticleComment = {
    id: string;
    article_id: string;
    author_id: string;
    parent_id: string | null;
    body: string;
    status: CommentStatus;
    is_public: boolean;
    show_on_profile: boolean;
    date_created: string | null;
    date_updated: string | null;
};

export type AppArticleLike = {
    id: string;
    article_id: string;
    user_id: string;
    status: AppStatus;
    date_created: string | null;
    date_updated: string | null;
};

export type AppDiaryLike = {
    id: string;
    diary_id: string;
    user_id: string;
    status: AppStatus;
    date_created: string | null;
    date_updated: string | null;
};

export type AppArticleCommentLike = {
    id: string;
    article_comment_id: string;
    user_id: string;
    status: AppStatus;
    date_created: string | null;
    date_updated: string | null;
};

export type AppDiaryCommentLike = {
    id: string;
    diary_comment_id: string;
    user_id: string;
    status: AppStatus;
    date_created: string | null;
    date_updated: string | null;
};

export type AppDiaryComment = {
    id: string;
    diary_id: string;
    author_id: string;
    parent_id: string | null;
    body: string;
    status: CommentStatus;
    is_public: boolean;
    show_on_profile: boolean;
    date_created: string | null;
    date_updated: string | null;
};

export type AppUserBlock = {
    id: string;
    blocker_id: string;
    blocked_user_id: string;
    reason: string | null;
    note: string | null;
    status: AppStatus;
    date_created: string | null;
    date_updated: string | null;
};

export type RegistrationRequestStatus =
    | "pending"
    | "approved"
    | "rejected"
    | "cancelled";

export type AppUserRegistrationRequest = {
    id: string;
    email: string;
    username: string;
    display_name: string;
    avatar_file: string | null;
    registration_reason: string;
    request_status: RegistrationRequestStatus;
    pending_user_id: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    reject_reason: string | null;
    approved_user_id: string | null;
    status: AppStatus;
    sort: number | null;
    user_created: string | null;
    date_created: string | null;
    user_updated: string | null;
    date_updated: string | null;
};

export type AppUser = {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    description?: string | null;
    avatar: string | null;
    status?: string | null;
    role: string | { id?: string; name?: string } | null;
    policies?: Array<
        string | { id?: string; name?: string; policy?: string }
    > | null;
};

export type AppFile = {
    id: string;
    title: string | null;
    type: string | null;
    filename_download: string | null;
    app_owner_user_id?: string | { id?: string } | null;
    app_visibility?: "private" | "public" | null;
    uploaded_by?: string | { id?: string } | null;
    modified_by?: string | { id?: string } | null;
};

export type AppSiteSettings = import("./site-settings").AppSiteSettings;

export type CommentAuthor = {
    id: string;
    name: string;
    avatar_url?: string;
    username?: string;
};

export type CommentTreeNode = {
    id: string;
    body: string;
    author_id: string;
    parent_id: string | null;
    created_at: string | null;
    author?: CommentAuthor;
    like_count?: number;
    liked_by_viewer?: boolean;
    replies: CommentTreeNode[];
};

export type ApiListResponse<T> = {
    ok: true;
    items: T[];
    page: number;
    limit: number;
    total: number;
};
