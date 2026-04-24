import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("@directus/sdk", () => {
    const client = {
        with() {
            return client;
        },
        request: requestMock,
    };

    return {
        aggregate: vi.fn(),
        createDirectus: vi.fn(() => client),
        createItem: vi.fn(),
        createUser: vi.fn(),
        customEndpoint: vi.fn((request: unknown) => request),
        deleteFile: vi.fn(),
        deleteItem: vi.fn(),
        readItem: vi.fn(),
        readItems: vi.fn(),
        readFiles: vi.fn(),
        readUser: vi.fn(),
        readUsers: vi.fn(),
        rest: vi.fn(() => ({})),
        staticToken: vi.fn(() => ({})),
        updateItem: vi.fn(),
        updateFile: vi.fn(),
        updateUser: vi.fn(),
        uploadFiles: vi.fn(),
        withToken: vi.fn((token: string, request: unknown) => ({
            token,
            request,
        })),
    };
});

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requestMock.mockReset();
    process.env.DIRECTUS_URL = "http://directus.test";
    process.env.DIRECTUS_WEB_STATIC_TOKEN = "directus-web-static-token";
    process.env.DIRECTUS_WORKER_STATIC_TOKEN = "";
});

describe("updateManyItemsByFilter", () => {
    it("业务集合继续走 /items 并发送 JSON 字符串 body", async () => {
        requestMock
            .mockResolvedValueOnce({
                data: [{ id: "like-1" }],
            })
            .mockResolvedValueOnce(null);

        const { runWithDirectusServiceAccess, updateManyItemsByFilter } =
            await import("@/server/directus/client");

        await runWithDirectusServiceAccess(async () => {
            await updateManyItemsByFilter({
                collection: "app_diary_likes",
                filter: { user_created: { _eq: "user-1" } },
                data: { user_created: null },
            });
        });

        const [getRequest, patchRequest] = requestMock.mock.calls.map(
            ([request]) => request,
        );

        expect(getRequest).toMatchObject({
            path: "/items/app_diary_likes",
            method: "GET",
        });
        expect(getRequest.params).toMatchObject({
            filter: { user_created: { _eq: "user-1" } },
            fields: ["id"],
            limit: 5000,
        });
        expect(patchRequest).toMatchObject({
            path: "/items/app_diary_likes",
            method: "PATCH",
        });
        expect(patchRequest.body).toBe(
            JSON.stringify({
                keys: ["like-1"],
                data: { user_created: null },
            }),
        );
    });

    it.each([
        ["directus_notifications", "/notifications"],
        ["directus_versions", "/versions"],
        ["directus_comments", "/comments"],
    ])("系统集合 %s 会切到正确端点 %s", async (collection, path) => {
        requestMock
            .mockResolvedValueOnce({
                data: [{ id: "row-1" }],
            })
            .mockResolvedValueOnce(null);

        const { runWithDirectusServiceAccess, updateManyItemsByFilter } =
            await import("@/server/directus/client");

        await runWithDirectusServiceAccess(async () => {
            await updateManyItemsByFilter({
                collection,
                filter: { user_updated: { _eq: "user-1" } },
                data: { user_updated: null },
            });
        });

        const [getRequest, patchRequest] = requestMock.mock.calls.map(
            ([request]) => request,
        );

        expect(getRequest).toMatchObject({
            path,
            method: "GET",
        });
        expect(patchRequest).toMatchObject({
            path,
            method: "PATCH",
            body: JSON.stringify({
                keys: ["row-1"],
                data: { user_updated: null },
            }),
        });
    });
});
