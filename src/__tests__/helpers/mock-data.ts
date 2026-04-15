/**
 * Mock 数据工厂
 *
 * 提供领域对象的 mock 构造函数，接受 Partial<T> 覆盖参数。
 */

import type {
    AppArticle,
    AppPermissions,
    AppProfile,
    AppProfileView,
} from "@/types/app";

import type { SessionUser } from "@/server/auth/session";

export function mockProfile(overrides: Partial<AppProfile> = {}): AppProfile {
    return {
        id: "profile-1",
        user_id: "user-1",
        username: "testuser",
        display_name: "Test User",
        header_file: null,
        profile_public: true,
        show_articles_on_profile: true,
        show_diaries_on_profile: true,
        show_bangumi_on_profile: true,
        show_albums_on_profile: true,
        show_comments_on_profile: true,
        bangumi_username: null,
        bangumi_include_private: false,
        bangumi_access_token_encrypted: null,
        social_links: null,
        home_section_order: null,
        is_official: false,
        status: "published",
        ...overrides,
    };
}

export function mockProfileView(
    overrides: Partial<AppProfileView> = {},
): AppProfileView {
    return {
        ...mockProfile(),
        bio: null,
        avatar_file: null,
        ...overrides,
    };
}

export function mockPermissions(
    overrides: Partial<AppPermissions> = {},
): AppPermissions {
    return {
        app_role: "member",
        can_publish_articles: true,
        can_comment_articles: true,
        can_manage_diaries: true,
        can_comment_diaries: true,
        can_manage_albums: true,
        can_upload_files: true,
        ...overrides,
    };
}

export function mockSessionUser(
    overrides: Partial<SessionUser> = {},
): SessionUser {
    return {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        avatarFileId: undefined,
        description: null,
        policyIds: [],
        policyNames: [],
        isSystemAdmin: false,
        ...overrides,
    };
}

export function mockAdminSessionUser(
    overrides: Partial<SessionUser> = {},
): SessionUser {
    return mockSessionUser({
        id: "admin-1",
        email: "admin@example.com",
        name: "Admin User",
        isSystemAdmin: true,
        ...overrides,
    });
}

export function mockArticle(overrides: Partial<AppArticle> = {}): AppArticle {
    return {
        id: "article-1",
        short_id: "abc123",
        author_id: "user-1",
        status: "published",
        title: "Test Article",
        slug: "test-article",
        summary: "A test article",
        body_markdown: "# Hello\n\nWorld",
        cover_file: null,
        cover_url: null,
        tags: ["test"],
        category: null,
        allow_comments: true,
        is_public: true,
        date_created: "2026-01-01T00:00:00.000Z",
        date_updated: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}
