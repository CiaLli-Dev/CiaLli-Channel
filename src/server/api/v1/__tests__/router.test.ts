import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

// ── mock 所有路由 handler ──

vi.mock("@/server/api/v1/public", () => ({
    handlePublic: vi.fn().mockResolvedValue(new Response("public-ok")),
    handleUserHome: vi.fn().mockResolvedValue(new Response("user-home-ok")),
}));

vi.mock("@/server/api/v1/me", () => ({
    handleMe: vi.fn().mockResolvedValue(new Response("me-ok")),
}));

vi.mock("@/server/api/v1/comments", () => ({
    handleArticleComments: vi
        .fn()
        .mockResolvedValue(new Response("article-comments-ok")),
    handleDiaryComments: vi
        .fn()
        .mockResolvedValue(new Response("diary-comments-ok")),
}));

vi.mock("@/server/api/v1/uploads", () => ({
    handleUploads: vi.fn().mockResolvedValue(new Response("uploads-ok")),
}));

vi.mock("@/server/api/v1/admin", () => ({
    handleAdminUsers: vi.fn().mockResolvedValue(new Response("admin-users-ok")),
    handleAdminRegistrationRequests: vi
        .fn()
        .mockResolvedValue(new Response("admin-reg-ok")),
    handleAdminContent: vi
        .fn()
        .mockResolvedValue(new Response("admin-content-ok")),
    handleAdminSettings: vi
        .fn()
        .mockResolvedValue(new Response("admin-settings-ok")),
}));

vi.mock("@/server/middleware/error-handler", () => ({
    withErrorHandler: vi.fn((fn) => fn),
}));

vi.mock("@/server/directus-auth", () => ({
    getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/server/security/csrf", () => ({
    assertCsrfToken: vi.fn().mockReturnValue(null),
}));

vi.mock("@/server/security/rate-limit", () => ({
    applyRateLimit: vi.fn().mockResolvedValue({ ok: true }),
    rateLimitResponse: vi.fn(),
}));

vi.mock("@/server/api/logger", () => ({
    createRequestLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

import { handlePublic, handleUserHome } from "@/server/api/v1/public";
import { handleMe } from "@/server/api/v1/me";
import {
    handleArticleComments,
    handleDiaryComments,
} from "@/server/api/v1/comments";
import { handleUploads } from "@/server/api/v1/uploads";
import {
    handleAdminUsers,
    handleAdminRegistrationRequests,
    handleAdminContent,
    handleAdminSettings,
} from "@/server/api/v1/admin";

import { handleV1 } from "@/server/api/v1/router";

const mockedHandlePublic = vi.mocked(handlePublic);
const mockedHandleUserHome = vi.mocked(handleUserHome);
const mockedHandleMe = vi.mocked(handleMe);
const mockedHandleArticleComments = vi.mocked(handleArticleComments);
const mockedHandleDiaryComments = vi.mocked(handleDiaryComments);
const mockedHandleUploads = vi.mocked(handleUploads);
const mockedHandleAdminUsers = vi.mocked(handleAdminUsers);
const mockedHandleAdminRegistrationRequests = vi.mocked(
    handleAdminRegistrationRequests,
);
const mockedHandleAdminContent = vi.mocked(handleAdminContent);
const mockedHandleAdminSettings = vi.mocked(handleAdminSettings);

beforeEach(() => {
    vi.clearAllMocks();
});

function makeCtx(
    path: string,
    method = "GET",
): ReturnType<typeof createMockAPIContext> {
    return createMockAPIContext({
        method,
        url: `http://localhost:4321/api/v1/${path}`,
        params: { segments: path },
    });
}

// ── 基础路由 ──

describe("handleV1 路由分发", () => {
    it("空路径 → ok", async () => {
        const ctx = makeCtx("");
        const res = await handleV1(ctx as unknown as APIContext);
        expect(res.status).toBe(200);
        const body = await parseResponseJson<{ ok: boolean; message: string }>(
            res,
        );
        expect(body.ok).toBe(true);
        expect(body.message).toBe("ok");
    });

    it("未知路径 → 404", async () => {
        const ctx = makeCtx("unknown-path");
        const res = await handleV1(ctx as unknown as APIContext);
        expect(res.status).toBe(404);
    });

    it("public/* → handlePublic", async () => {
        const ctx = makeCtx("public/articles");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandlePublic).toHaveBeenCalled();
    });

    it("users/* → handleUserHome", async () => {
        const ctx = makeCtx("users/alice");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleUserHome).toHaveBeenCalled();
    });

    it("me/* → handleMe", async () => {
        const ctx = makeCtx("me/articles");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleMe).toHaveBeenCalled();
    });

    it("articles/* → handleArticleComments", async () => {
        const ctx = makeCtx("articles/123/comments");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleArticleComments).toHaveBeenCalled();
    });

    it("diaries/* → handleDiaryComments", async () => {
        const ctx = makeCtx("diaries/456/comments");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleDiaryComments).toHaveBeenCalled();
    });

    it("uploads → handleUploads", async () => {
        const ctx = makeCtx("uploads");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleUploads).toHaveBeenCalled();
    });

    it("admin/users → handleAdminUsers", async () => {
        const ctx = makeCtx("admin/users");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleAdminUsers).toHaveBeenCalled();
    });

    it("admin/registration-requests → handleAdminRegistrationRequests", async () => {
        const ctx = makeCtx("admin/registration-requests");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleAdminRegistrationRequests).toHaveBeenCalled();
    });

    it("admin/content → handleAdminContent", async () => {
        const ctx = makeCtx("admin/content");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleAdminContent).toHaveBeenCalled();
    });

    it("admin/settings → handleAdminSettings", async () => {
        const ctx = makeCtx("admin/settings");
        await handleV1(ctx as unknown as APIContext);
        expect(mockedHandleAdminSettings).toHaveBeenCalled();
    });
});
