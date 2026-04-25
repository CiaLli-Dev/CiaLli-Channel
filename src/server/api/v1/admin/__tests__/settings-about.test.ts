import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

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
import { createOne, readMany, updateOne } from "@/server/directus/client";
import { renderMarkdown } from "@/server/markdown/render";
import { handleAdminSettings } from "@/server/api/v1/admin/settings";

const mockedRequireAdmin = vi.mocked(requireAdmin);
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
