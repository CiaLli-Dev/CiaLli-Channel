import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import { defaultSiteSettings } from "@/config";

vi.mock("@/server/api/v1/shared/auth", () => ({
    requireAdmin: vi.fn(),
}));

vi.mock("@/server/site-settings/service", () => ({
    getResolvedSiteSettings: vi.fn(),
    invalidateSiteSettingsCache: vi.fn(),
    resolveSiteSettingsPayload: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    readMany: vi.fn(),
    runWithDirectusUserAccess: vi.fn(
        async (_token: string, task: () => Promise<unknown>) => await task(),
    ),
    updateDirectusFileMetadata: vi.fn(),
    updateOne: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", async () => {
    const actual =
        await import("@/server/api/v1/shared/file-cleanup-reference-utils");
    return {
        extractDirectusFileIdsFromUnknown:
            actual.extractDirectusFileIdsFromUnknown,
        cleanupOwnedOrphanDirectusFiles: vi.fn(),
    };
});

vi.mock("@/server/api/v1/me/_helpers", () => ({
    deleteFileReferencesForOwner: vi.fn().mockResolvedValue(0),
    detachManagedFiles: vi.fn().mockResolvedValue([]),
    syncMarkdownFileLifecycle: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
}));

vi.mock("@/server/files/resource-lifecycle", () => ({
    resourceLifecycle: {
        syncOwnerReferences: vi.fn().mockResolvedValue({
            attachedFileIds: [],
            detachedFileIds: [],
            currentFileIds: [],
        }),
    },
}));

vi.mock("@/server/markdown/render", () => ({
    renderMarkdown: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        invalidate: vi.fn(),
        invalidateByDomain: vi.fn(),
    },
}));

import { requireAdmin } from "@/server/api/v1/shared/auth";
import {
    getResolvedSiteSettings,
    invalidateSiteSettingsCache,
    resolveSiteSettingsPayload,
} from "@/server/site-settings/service";
import {
    createOne,
    readMany,
    updateDirectusFileMetadata,
    updateOne,
} from "@/server/directus/client";
import { renderMarkdown } from "@/server/markdown/render";
import { handleAdminSettings } from "@/server/api/v1/admin/settings";
import { detachManagedFiles } from "@/server/api/v1/me/_helpers";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedGetResolvedSiteSettings = vi.mocked(getResolvedSiteSettings);
const mockedInvalidateSiteSettingsCache = vi.mocked(
    invalidateSiteSettingsCache,
);
const mockedResolveSiteSettingsPayload = vi.mocked(resolveSiteSettingsPayload);
const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedUpdateDirectusFileMetadata = vi.mocked(updateDirectusFileMetadata);
const mockedRenderMarkdown = vi.mocked(renderMarkdown);
const mockedDetachManagedFiles = vi.mocked(detachManagedFiles);
const mockedSyncOwnerReferences = vi.mocked(
    resourceLifecycle.syncOwnerReferences,
);

function makeCtx(
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
): ReturnType<typeof createMockAPIContext> {
    return createMockAPIContext({
        method,
        url: `http://localhost:4321/api/v1/${path}`,
        params: { segments: path },
        body,
    });
}

describe("handleAdminSettings /bulletin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.PUBLIC_ASSET_BASE_URL;
        mockedRequireAdmin.mockResolvedValue({
            access: {
                isAdmin: true,
                user: {
                    id: "admin-1",
                },
            },
            accessToken: "test-access-token",
        } as never);
    });

    it("权限不足时直接返回鉴权响应", async () => {
        mockedRequireAdmin.mockResolvedValue({
            response: new Response("denied", { status: 403 }),
        } as never);
        const ctx = makeCtx("admin/settings/bulletin");
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "bulletin"],
        );
        expect(response.status).toBe(403);
    });

    it("GET /admin/settings/bulletin 返回公告配置", async () => {
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                title: "公告标题",
                summary: "摘要",
                body_markdown: "# 正文",
                closable: true,
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);

        const ctx = makeCtx("admin/settings/bulletin");
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "bulletin"],
        );
        expect(response.status).toBe(200);

        const body = await parseResponseJson<{
            ok: boolean;
            announcement: {
                title: string;
                summary: string;
                body_markdown: string;
            };
            updated_at: string;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.announcement.title).toBe("公告标题");
        expect(body.announcement.body_markdown).toBe("# 正文");
        expect(body.updated_at).toBe("2026-02-15T12:00:00.000Z");
    });

    it("POST /admin/settings/bulletin/preview 渲染 Markdown 预览", async () => {
        mockedRenderMarkdown.mockResolvedValue("<h1>正文</h1>");
        const ctx = makeCtx("admin/settings/bulletin/preview", "POST", {
            body_markdown: "# 正文",
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "bulletin", "preview"],
        );
        expect(response.status).toBe(200);

        const body = await parseResponseJson<{
            ok: boolean;
            body_markdown: string;
            body_html: string;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.body_markdown).toBe("# 正文");
        expect(body.body_html).toBe("<h1>正文</h1>");
    });

    it("PATCH /admin/settings/bulletin 更新公告配置并刷新缓存", async () => {
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {} as never,
            settings: {
                announcement: {
                    title: "旧标题",
                    summary: "旧摘要",
                    body_markdown: "旧正文",
                    closable: true,
                },
            },
        } as never);
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({
            date_updated: "2026-02-16T00:00:00.000Z",
            date_created: "2026-02-10T12:00:00.000Z",
        } as never);

        const ctx = makeCtx("admin/settings/bulletin", "PATCH", {
            title: "新标题",
            summary: "新摘要",
            body_markdown: "# 新正文",
            closable: false,
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "bulletin"],
        );
        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledTimes(1);
        expect(mockedInvalidateSiteSettingsCache).toHaveBeenCalledTimes(1);
        expect(mockedUpdateOne.mock.calls[0]?.[0]).toBe(
            "app_site_announcements",
        );
        expect(mockedUpdateOne.mock.calls[0]?.[1]).toBe("row-1");
        expect(mockedUpdateOne.mock.calls[0]?.[2]).toEqual({
            key: "default",
            status: "published",
            title: "新标题",
            summary: "新摘要",
            body_markdown: "# 新正文",
            closable: false,
        });

        const body = await parseResponseJson<{
            ok: boolean;
            announcement: {
                title: string;
                summary: string;
                body_markdown: string;
                closable: boolean;
            };
            updated_at: string;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.announcement.title).toBe("新标题");
        expect(body.announcement.summary).toBe("新摘要");
        expect(body.announcement.body_markdown).toBe("# 新正文");
        expect(body.announcement.closable).toBe(false);
        expect(body.updated_at).toBe("2026-02-16T00:00:00.000Z");
    });
});

describe("handleAdminSettings /site", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedRequireAdmin.mockResolvedValue({
            access: {
                isAdmin: true,
                user: {
                    id: "admin-1",
                },
            },
            accessToken: "test-access-token",
        } as never);
    });

    it("GET /admin/settings/site 返回站点设置与更新时间", async () => {
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {
                timeZone: "Asia/Shanghai",
            },
            settings: {
                site: {
                    title: "CiaLli",
                    subtitle: "内容社区",
                    lang: "zh_CN",
                    timeZone: "Asia/Shanghai",
                    themePreset: "purple",
                    keywords: ["文章"],
                    siteStartDate: "2026-02-01",
                    favicon: [],
                },
            },
        } as never);
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);

        const ctx = makeCtx("admin/settings/site");
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "site"],
        );
        expect(response.status).toBe(200);

        const body = await parseResponseJson<{
            ok: boolean;
            settings: {
                site: {
                    timeZone: string | null;
                };
            };
            updated_at: string | null;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.settings.site.timeZone).toBe("Asia/Shanghai");
        expect(body.updated_at).toBe("2026-02-15T12:00:00.000Z");
    });

    it("PATCH /admin/settings/site 保存站点时区", async () => {
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {
                timeZone: "Asia/Shanghai",
            },
            settings: {
                ...defaultSiteSettings,
                site: {
                    ...defaultSiteSettings.site,
                    title: "旧标题",
                    timeZone: null,
                },
            },
        } as never);
        mockedResolveSiteSettingsPayload.mockReturnValue({
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                title: "旧标题",
                timeZone: "UTC",
                themePreset: "teal",
            },
            announcement: {
                title: "不应写入",
                summary: "不应写入",
                body_markdown: "不应写入",
                closable: false,
            },
        } as never);
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({
            date_updated: "2026-02-16T00:00:00.000Z",
            date_created: "2026-02-10T12:00:00.000Z",
        } as never);

        const ctx = makeCtx("admin/settings/site", "PATCH", {
            site: {
                timeZone: "UTC",
                themePreset: "teal",
            },
            announcement: {
                title: "前端误传公告",
            },
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "site"],
        );
        expect(response.status).toBe(200);
        expect(mockedResolveSiteSettingsPayload).toHaveBeenCalledWith(
            expect.objectContaining({
                site: expect.objectContaining({
                    timeZone: "UTC",
                    themePreset: "teal",
                }),
            }),
            expect.anything(),
        );
        expect(
            mockedResolveSiteSettingsPayload.mock.calls[0]?.[0],
        ).not.toHaveProperty("announcement");
        const updatePayload = mockedUpdateOne.mock.calls[0]?.[2] as
            | Record<string, unknown>
            | undefined;
        expect(mockedUpdateOne.mock.calls[0]?.[0]).toBe("app_site_settings");
        expect(mockedUpdateOne.mock.calls[0]?.[1]).toBe("row-1");
        expect(updatePayload).toEqual(
            expect.objectContaining({
                key: "default",
                status: "published",
                theme_preset: "teal",
                settings_site: expect.objectContaining({
                    site: expect.objectContaining({
                        timeZone: "UTC",
                    }),
                }),
            }),
        );
        expect(updatePayload).not.toHaveProperty("settings");

        const body = await parseResponseJson<{
            ok: boolean;
            settings: {
                site: {
                    timeZone: string | null;
                    themePreset: string;
                };
            };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.settings.site.timeZone).toBe("UTC");
        expect(body.settings.site.themePreset).toBe("teal");
    });

    it("PATCH /admin/settings/site 保存关闭波浪效果并在响应前等待缓存失效", async () => {
        let finishInvalidation: (() => void) | undefined;
        const invalidationFinished = new Promise<void>((resolve) => {
            finishInvalidation = resolve;
        });
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {
                timeZone: "Asia/Shanghai",
            },
            settings: defaultSiteSettings,
        } as never);
        mockedResolveSiteSettingsPayload.mockReturnValue({
            ...defaultSiteSettings,
            banner: {
                ...defaultSiteSettings.banner,
                waves: {
                    enable: false,
                },
            },
        } as never);
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({
            date_updated: "2026-02-16T00:00:00.000Z",
            date_created: "2026-02-10T12:00:00.000Z",
        } as never);
        mockedInvalidateSiteSettingsCache.mockReturnValueOnce(
            invalidationFinished as never,
        );

        const ctx = makeCtx("admin/settings/site", "PATCH", {
            banner: {
                waves: {
                    enable: false,
                },
            },
        });
        const responseTask = handleAdminSettings(ctx as unknown as APIContext, [
            "settings",
            "site",
        ]);
        const earlyResult = await Promise.race([
            responseTask.then(() => "response"),
            Promise.resolve("pending"),
        ]);

        expect(earlyResult).toBe("pending");

        finishInvalidation?.();
        const response = await responseTask;

        expect(response.status).toBe(200);
        expect(mockedInvalidateSiteSettingsCache).toHaveBeenCalledTimes(1);
        expect(mockedUpdateOne.mock.calls[0]?.[0]).toBe("app_site_settings");
        expect(mockedUpdateOne.mock.calls[0]?.[1]).toBe("row-1");
        expect(mockedUpdateOne.mock.calls[0]?.[2]).toEqual(
            expect.objectContaining({
                settings_home: expect.objectContaining({
                    banner: expect.objectContaining({
                        waves: {
                            enable: false,
                        },
                    }),
                }),
            }),
        );

        const body = await parseResponseJson<{
            ok: boolean;
            settings: {
                banner: {
                    waves?: {
                        enable: boolean;
                    };
                };
            };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.settings.banner.waves?.enable).toBe(false);
    });
});

describe("handleAdminSettings /site wallpaper lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedRequireAdmin.mockResolvedValue({
            access: {
                isAdmin: true,
                user: {
                    id: "admin-1",
                },
            },
            accessToken: "test-access-token",
        } as never);
    });

    it("PATCH /admin/settings/site 删除最后一张首页壁纸时 detach 旧文件", async () => {
        const oldWallpaperFileId = "a1b2c3d4-e5f6-1234-9abc-def012345678";
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {
                timeZone: "Asia/Shanghai",
            },
            settings: {
                ...defaultSiteSettings,
                banner: {
                    ...defaultSiteSettings.banner,
                    src: `/api/v1/assets/${oldWallpaperFileId}`,
                },
            },
        } as never);
        mockedResolveSiteSettingsPayload.mockReturnValue({
            ...defaultSiteSettings,
            banner: {
                ...defaultSiteSettings.banner,
                src: [],
            },
        } as never);
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({
            date_updated: "2026-02-16T00:00:00.000Z",
            date_created: "2026-02-10T12:00:00.000Z",
        } as never);

        const ctx = makeCtx("admin/settings/site", "PATCH", {
            banner: {
                src: [],
            },
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "site"],
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateDirectusFileMetadata).not.toHaveBeenCalled();
        expect(mockedSyncOwnerReferences).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerCollection: "app_site_settings",
                ownerId: "default",
                references: [
                    {
                        ownerField: "settings",
                        referenceKind: "settings_asset",
                        fileIds: [],
                    },
                ],
            }),
        );
        expect(mockedDetachManagedFiles).not.toHaveBeenCalledWith([
            oldWallpaperFileId,
        ]);
    });

    it("PATCH /admin/settings/site 保存新首页壁纸时识别私有资源路径并标记 attached", async () => {
        const newWallpaperFileId = "f1e2d3c4-b5a6-4234-8abc-fedcba987654";
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {
                timeZone: "Asia/Shanghai",
            },
            settings: defaultSiteSettings,
        } as never);
        mockedResolveSiteSettingsPayload.mockReturnValue({
            ...defaultSiteSettings,
            banner: {
                ...defaultSiteSettings.banner,
                src: `/api/v1/assets/${newWallpaperFileId}`,
            },
        } as never);
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({
            date_updated: "2026-02-16T00:00:00.000Z",
            date_created: "2026-02-10T12:00:00.000Z",
        } as never);

        const ctx = makeCtx("admin/settings/site", "PATCH", {
            banner: {
                src: [newWallpaperFileId],
            },
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "site"],
        );

        expect(response.status).toBe(200);
        expect(mockedSyncOwnerReferences).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerCollection: "app_site_settings",
                ownerId: "default",
                ownerUserId: "admin-1",
                visibility: "public",
                references: [
                    {
                        ownerField: "settings",
                        referenceKind: "settings_asset",
                        fileIds: [newWallpaperFileId],
                    },
                ],
            }),
        );
        expect(mockedUpdateDirectusFileMetadata).not.toHaveBeenCalled();
        expect(mockedDetachManagedFiles).not.toHaveBeenCalled();
    });

    it("PATCH /admin/settings/site 用共享提取器识别 settings 文件引用格式", async () => {
        process.env.PUBLIC_ASSET_BASE_URL = "https://cdn.example.com/assets";
        const oldFaviconFileId = "a1b2c3d4-e5f6-1234-9abc-def012345678";
        const newFaviconFileId = "f1e2d3c4-b5a6-4234-8abc-fedcba987654";
        const newBannerFileId = "11111111-2222-4333-8abc-444444444444";
        const newIconFileId = "22222222-3333-4444-8abc-555555555555";
        const newAvatarFileId = "33333333-4444-4555-8abc-666666666666";
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {
                timeZone: "Asia/Shanghai",
            },
            settings: {
                ...defaultSiteSettings,
                site: {
                    ...defaultSiteSettings.site,
                    favicon: [{ src: oldFaviconFileId }],
                },
            },
        } as never);
        mockedResolveSiteSettingsPayload.mockReturnValue({
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                favicon: [{ src: `/assets/${newFaviconFileId}` }],
            },
            banner: {
                ...defaultSiteSettings.banner,
                src: `https://cdn.example.com/assets/${newBannerFileId}`,
            },
            navbarTitle: {
                ...defaultSiteSettings.navbarTitle,
                icon: `/api/v1/public/assets/${newIconFileId}`,
            },
            profile: {
                ...defaultSiteSettings.profile,
                avatar: { id: newAvatarFileId },
            },
        } as never);
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({
            date_updated: "2026-02-16T00:00:00.000Z",
            date_created: "2026-02-10T12:00:00.000Z",
        } as never);

        const ctx = makeCtx("admin/settings/site", "PATCH", {
            site: {
                favicon: [{ src: `/assets/${newFaviconFileId}` }],
            },
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "site"],
        );

        expect(response.status).toBe(200);
        expect(mockedSyncOwnerReferences).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerCollection: "app_site_settings",
                ownerId: "default",
                references: [
                    {
                        ownerField: "settings",
                        referenceKind: "settings_asset",
                        fileIds: [
                            newFaviconFileId,
                            newBannerFileId,
                            newIconFileId,
                            newAvatarFileId,
                        ],
                    },
                ],
            }),
        );
        expect(mockedUpdateDirectusFileMetadata).not.toHaveBeenCalled();
        expect(mockedDetachManagedFiles).not.toHaveBeenCalledWith([
            oldFaviconFileId,
        ]);
    });
});

describe("handleAdminSettings /site full payload", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedRequireAdmin.mockResolvedValue({
            access: {
                isAdmin: true,
                user: {
                    id: "admin-1",
                },
            },
            accessToken: "test-access-token",
        } as never);
    });

    it("PATCH /admin/settings/site 接受当前后台整包配置结构", async () => {
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {
                timeZone: "Asia/Shanghai",
            },
            settings: defaultSiteSettings,
        } as never);
        mockedResolveSiteSettingsPayload.mockReturnValue({
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                title: "整包标题",
                themePreset: "orange",
            },
        } as never);
        mockedReadMany.mockResolvedValue([
            {
                id: "row-1",
                date_updated: "2026-02-15T12:00:00.000Z",
                date_created: "2026-02-10T12:00:00.000Z",
            },
        ] as never);
        mockedUpdateOne.mockResolvedValue({
            date_updated: "2026-02-16T00:00:00.000Z",
            date_created: "2026-02-10T12:00:00.000Z",
        } as never);

        const ctx = makeCtx("admin/settings/site", "PATCH", {
            ...defaultSiteSettings,
            site: {
                ...defaultSiteSettings.site,
                title: "整包标题",
                themePreset: "orange",
            },
            announcement: {
                title: "前端整包误传公告",
            },
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "site"],
        );
        expect(response.status).toBe(200);
        expect(mockedResolveSiteSettingsPayload).toHaveBeenCalledWith(
            expect.objectContaining({
                site: expect.objectContaining({
                    title: "整包标题",
                    themePreset: "orange",
                }),
                banner: expect.objectContaining({
                    carousel: expect.objectContaining({
                        interval: 5,
                    }),
                }),
                navBar: expect.objectContaining({
                    links: expect.any(Array),
                }),
            }),
            expect.anything(),
        );
        expect(
            mockedResolveSiteSettingsPayload.mock.calls[0]?.[0],
        ).not.toHaveProperty("announcement");
        expect(mockedUpdateOne.mock.calls[0]?.[2]).toEqual(
            expect.objectContaining({
                theme_preset: "orange",
                settings_site: expect.objectContaining({
                    site: expect.objectContaining({
                        title: "整包标题",
                    }),
                }),
            }),
        );
    });
});

describe("handleAdminSettings /site validation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedRequireAdmin.mockResolvedValue({
            access: {
                isAdmin: true,
                user: {
                    id: "admin-1",
                },
            },
            accessToken: "test-access-token",
        } as never);
    });

    const invalidSitePatchCases: {
        name: string;
        payload: Record<string, unknown>;
    }[] = [
        {
            name: "未知顶层字段",
            payload: {
                sakura: {
                    enable: true,
                },
            },
        },
        {
            name: "废弃 banner.imageApi 字段",
            payload: {
                banner: {
                    imageApi: "/api/banner",
                },
            },
        },
        {
            name: "导航链接未知字段",
            payload: {
                navBar: {
                    links: [
                        {
                            name: "首页",
                            url: "/",
                            badKey: true,
                        },
                    ],
                },
            },
        },
        {
            name: "非法壁纸模式枚举",
            payload: {
                wallpaperMode: {
                    defaultMode: "video",
                },
            },
        },
        {
            name: "非法 TOC 模式枚举",
            payload: {
                toc: {
                    mode: "dock",
                },
            },
        },
        {
            name: "关键词不是数组",
            payload: {
                site: {
                    keywords: "文章,日记",
                },
            },
        },
        {
            name: "导航链接不是数组",
            payload: {
                navBar: {
                    links: {},
                },
            },
        },
        {
            name: "打字机速度不是数字",
            payload: {
                banner: {
                    homeText: {
                        typewriter: {
                            speed: "fast",
                        },
                    },
                },
            },
        },
    ];

    for (const testCase of invalidSitePatchCases) {
        it(`PATCH /admin/settings/site 拒绝${testCase.name}`, async () => {
            const ctx = makeCtx(
                "admin/settings/site",
                "PATCH",
                testCase.payload,
            );
            const response = await handleAdminSettings(
                ctx as unknown as APIContext,
                ["settings", "site"],
            );
            expect(response.status).toBe(400);

            const body = await parseResponseJson<{
                ok: boolean;
                error: {
                    code: string;
                    message: string;
                };
            }>(response);
            expect(body.ok).toBe(false);
            expect(body.error.code).toBe("VALIDATION_ERROR");
            expect(mockedResolveSiteSettingsPayload).not.toHaveBeenCalled();
            expect(mockedUpdateOne).not.toHaveBeenCalled();
        });
    }

    it("PATCH /admin/settings/site 拒绝非法站点时区", async () => {
        const ctx = makeCtx("admin/settings/site", "PATCH", {
            site: {
                timeZone: "Mars/Olympus",
            },
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "site"],
        );
        expect(response.status).toBe(400);

        const body = await parseResponseJson<{
            ok: boolean;
            error: {
                code: string;
                message: string;
            };
        }>(response);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe("INVALID_TIME_ZONE");
    });
});

describe("handleAdminSettings /about", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedRequireAdmin.mockResolvedValue({
            access: {
                isAdmin: true,
                user: {
                    id: "admin-1",
                },
            },
            accessToken: "test-access-token",
        } as never);
    });

    it("GET /admin/settings/about 返回关于页配置", async () => {
        mockedReadMany.mockResolvedValue([
            {
                id: "about-id",
                title: "关于 CiaLli",
                summary: "这里是摘要",
                body_markdown: "# 关于内容",
                date_updated: "2026-02-16T08:00:00.000Z",
                date_created: "2026-02-15T08:00:00.000Z",
            },
        ] as never);

        const ctx = makeCtx("admin/settings/about");
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "about"],
        );
        expect(response.status).toBe(200);

        const body = await parseResponseJson<{
            ok: boolean;
            about: {
                id: string;
                title: string;
                summary: string;
                body_markdown: string;
            };
            updated_at: string;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.about.id).toBe("about-id");
        expect(body.about.title).toBe("关于 CiaLli");
        expect(body.about.body_markdown).toBe("# 关于内容");
        expect(body.updated_at).toBe("2026-02-16T08:00:00.000Z");
    });

    it("PATCH /admin/settings/about 不存在则创建", async () => {
        mockedReadMany.mockResolvedValue([] as never);
        mockedCreateOne.mockResolvedValue({
            id: "about-id",
            title: "关于我们",
            summary: "摘要",
            body_markdown: "# 内容",
            date_updated: "2026-02-17T00:00:00.000Z",
            date_created: "2026-02-17T00:00:00.000Z",
        } as never);

        const ctx = makeCtx("admin/settings/about", "PATCH", {
            title: "关于我们",
            summary: "摘要",
            body_markdown: "# 内容",
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "about"],
        );
        expect(response.status).toBe(200);
        expect(mockedCreateOne).toHaveBeenCalledTimes(1);
        expect(mockedUpdateOne).not.toHaveBeenCalled();

        const body = await parseResponseJson<{
            ok: boolean;
            about: {
                id: string;
                title: string;
                summary: string;
                body_markdown: string;
            };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.about.id).toBe("about-id");
        expect(body.about.body_markdown).toBe("# 内容");
    });

    it("POST /admin/settings/about/preview 渲染 Markdown 预览", async () => {
        mockedRenderMarkdown.mockResolvedValue("<h1>关于内容</h1>");
        const ctx = makeCtx("admin/settings/about/preview", "POST", {
            body_markdown: "# 关于内容",
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "about", "preview"],
        );
        expect(response.status).toBe(200);

        const body = await parseResponseJson<{
            ok: boolean;
            body_markdown: string;
            body_html: string;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.body_markdown).toBe("# 关于内容");
        expect(body.body_html).toBe("<h1>关于内容</h1>");
    });
});
