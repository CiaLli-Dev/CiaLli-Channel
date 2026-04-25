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
        readFile: vi.fn((id: string, query?: unknown) => ({
            path: `/files/${id}`,
            method: "GET",
            params: query ?? {},
        })),
        readItem: vi.fn(),
        readItems: vi.fn(),
        readFiles: vi.fn(),
        readUser: vi.fn(),
        readUsers: vi.fn(),
        rest: vi.fn(() => ({})),
        staticToken: vi.fn(() => ({})),
        updateItem: vi.fn(),
        updateItems: vi.fn(
            (
                collection: string,
                keysOrQuery: unknown,
                data: unknown,
                query?: unknown,
            ) => ({
                path: `/items/${collection}`,
                method: "PATCH",
                params: query ?? {},
                body: JSON.stringify(
                    Array.isArray(keysOrQuery)
                        ? { keys: keysOrQuery, data }
                        : { query: keysOrQuery, data },
                ),
            }),
        ),
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

describe("readOneById", () => {
    it("系统文件集合使用 /files/:id 端点读取，避免走通用 items 接口", async () => {
        requestMock.mockResolvedValue({
            id: "file-1",
            app_visibility: "public",
            app_lifecycle: "attached",
        });

        const sdk = await import("@directus/sdk");
        const { readOneById, runWithDirectusServiceAccess } =
            await import("@/server/directus/client");

        const result = await runWithDirectusServiceAccess(
            async () =>
                await readOneById("directus_files", "file-1", {
                    fields: ["id", "app_visibility", "app_lifecycle"],
                }),
        );

        expect(result).toMatchObject({
            id: "file-1",
            app_visibility: "public",
        });
        expect(sdk.readFile).toHaveBeenCalledWith("file-1", {
            fields: ["id", "app_visibility", "app_lifecycle"],
            deep: undefined,
        });
        expect(sdk.readItem).not.toHaveBeenCalled();
        expect(requestMock).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "/files/file-1",
                method: "GET",
            }),
        );
    });
});

describe("updateMany", () => {
    it("uses Directus SDK query mode for filtered updates", async () => {
        requestMock.mockResolvedValue([{ id: "article-1" }]);

        const { runWithDirectusServiceAccess, updateMany } =
            await import("@/server/directus/client");

        await runWithDirectusServiceAccess(async () => {
            await updateMany(
                "app_articles",
                {
                    filter: { id: { _eq: "article-1" } },
                    limit: 1,
                },
                {
                    summary_error: null,
                },
                {
                    fields: ["id"],
                },
            );
        });

        expect(requestMock).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "/items/app_articles",
                method: "PATCH",
                params: {
                    fields: ["id"],
                },
                body: JSON.stringify({
                    query: {
                        filter: { id: { _eq: "article-1" } },
                        limit: 1,
                    },
                    data: {
                        summary_error: null,
                    },
                }),
            }),
        );
    });
});

describe("updateDirectusFilesByFilter", () => {
    it("uses the files endpoint query mode for conditional metadata updates", async () => {
        requestMock.mockResolvedValue({ data: [{ id: "file-1" }] });

        const { runWithDirectusServiceAccess, updateDirectusFilesByFilter } =
            await import("@/server/directus/client");

        const updated = await runWithDirectusServiceAccess(async () =>
            updateDirectusFilesByFilter({
                filter: {
                    _and: [
                        { id: { _eq: "file-1" } },
                        { app_lifecycle: { _eq: "quarantined" } },
                    ],
                },
                data: {
                    app_lifecycle: "deleting",
                    app_delete_next_retry_at: "2026-04-28T00:15:00.000Z",
                },
                limit: 1,
                fields: ["id"],
            }),
        );

        expect(requestMock).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "/files",
                method: "PATCH",
                params: { fields: ["id"] },
                body: JSON.stringify({
                    query: {
                        filter: {
                            _and: [
                                { id: { _eq: "file-1" } },
                                { app_lifecycle: { _eq: "quarantined" } },
                            ],
                        },
                        limit: 1,
                    },
                    data: {
                        app_lifecycle: "deleting",
                        app_delete_next_retry_at: "2026-04-28T00:15:00.000Z",
                    },
                }),
            }),
        );
        expect(updated).toEqual([{ id: "file-1" }]);
    });
});
