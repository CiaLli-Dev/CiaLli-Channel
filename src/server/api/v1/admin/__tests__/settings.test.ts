import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import { defaultSiteSettings } from "@/config";

vi.mock("@/server/api/v1/shared", () => ({
    requireAdmin: vi.fn(),
    nowIso: vi.fn(() => "2026-02-17T00:00:00.000Z"),
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

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    cleanupOwnedOrphanDirectusFiles: vi.fn(),
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

import { requireAdmin } from "@/server/api/v1/shared";
import {
    getResolvedSiteSettings,
    invalidateSiteSettingsCache,
    resolveSiteSettingsPayload,
} from "@/server/site-settings/service";
import { createOne, readMany, updateOne } from "@/server/directus/client";
import { renderMarkdown } from "@/server/markdown/render";
import { handleAdminSettings } from "@/server/api/v1/admin/settings";

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedGetResolvedSiteSettings = vi.mocked(getResolvedSiteSettings);
const mockedInvalidateSiteSettingsCache = vi.mocked(
    invalidateSiteSettingsCache,
);
const mockedResolveSiteSettingsPayload = vi.mocked(resolveSiteSettingsPayload);
const mockedCreateOne = vi.mocked(createOne);
const mockedReadMany = vi.mocked(readMany);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedRenderMarkdown = vi.mocked(renderMarkdown);

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
        mockedGetResolvedSiteSettings.mockResolvedValue({
            system: {} as never,
            settings: {
                announcement: {
                    title: "公告标题",
                    summary: "摘要",
                    body_markdown: "# 正文",
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
        mockedResolveSiteSettingsPayload.mockReturnValue({
            announcement: {
                title: "新标题",
                summary: "新摘要",
                body_markdown: "# 新正文",
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
        expect(mockedResolveSiteSettingsPayload).toHaveBeenCalledTimes(1);
        expect(mockedUpdateOne).toHaveBeenCalledTimes(1);
        expect(mockedInvalidateSiteSettingsCache).toHaveBeenCalledTimes(1);

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
                    subtitle: "个人博客",
                    lang: "zh_CN",
                    timeZone: "Asia/Shanghai",
                    keywords: ["blog"],
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
            },
        });
        const response = await handleAdminSettings(
            ctx as unknown as APIContext,
            ["settings", "site"],
        );
        expect(response.status).toBe(200);
        expect(mockedResolveSiteSettingsPayload).toHaveBeenCalledWith(
            {
                site: {
                    timeZone: "UTC",
                },
            },
            expect.anything(),
        );

        const body = await parseResponseJson<{
            ok: boolean;
            settings: {
                site: {
                    timeZone: string | null;
                };
            };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.settings.site.timeZone).toBe("UTC");
    });

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
