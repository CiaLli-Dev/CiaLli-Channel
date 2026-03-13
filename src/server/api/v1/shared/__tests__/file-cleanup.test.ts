import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/directus/client", () => ({
    deleteDirectusFile: vi.fn().mockResolvedValue(undefined),
    readMany: vi.fn(),
    runWithDirectusServiceAccess: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

import {
    cleanupOwnedOrphanDirectusFiles,
    collectReferencedDirectusFileIds,
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup";
import {
    deleteDirectusFile,
    readMany,
    runWithDirectusServiceAccess,
} from "@/server/directus/client";

const mockedReadMany = vi.mocked(readMany);
const mockedDeleteDirectusFile = vi.mocked(deleteDirectusFile);
const mockedRunWithDirectusServiceAccess = vi.mocked(
    runWithDirectusServiceAccess,
);

const UUID_A = "a1b2c3d4-e5f6-1234-9abc-def012345678";
const UUID_B = "f1e2d3c4-b5a6-4234-8abc-fedcba987654";

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PUBLIC_ASSET_BASE_URL;
});

describe("normalizeDirectusFileId", () => {
    it("string UUID → 返回小写 UUID", () => {
        expect(normalizeDirectusFileId(UUID_A)).toBe(UUID_A);
    });

    it("大写 UUID → 返回小写", () => {
        expect(normalizeDirectusFileId(UUID_A.toUpperCase())).toBe(UUID_A);
    });

    it("对象含 id → 递归处理", () => {
        expect(normalizeDirectusFileId({ id: UUID_A })).toBe(UUID_A);
    });

    it("非 UUID 字符串 → null", () => {
        expect(normalizeDirectusFileId("not-a-uuid")).toBe(null);
    });
});

describe("extractDirectusAssetIdsFromMarkdown", () => {
    it("仅提取受支持的相对资源 URL", () => {
        expect(
            extractDirectusAssetIdsFromMarkdown(
                `![a](/api/v1/public/assets/${UUID_A}) ![b](/api/v1/assets/${UUID_B}?width=320)`,
            ),
        ).toEqual([UUID_A, UUID_B]);
    });

    it("忽略纯文本 UUID", () => {
        expect(
            extractDirectusAssetIdsFromMarkdown(
                `victim uuid ${UUID_A} should stay untouched`,
            ),
        ).toEqual([]);
    });

    it("支持 PUBLIC_ASSET_BASE_URL 外链格式", () => {
        process.env.PUBLIC_ASSET_BASE_URL = "https://cdn.example.com/assets";

        expect(
            extractDirectusAssetIdsFromMarkdown(
                `![cdn](https://cdn.example.com/${UUID_A}?format=webp)`,
            ),
        ).toEqual([UUID_A]);
    });
});

describe("collectReferencedDirectusFileIds", () => {
    it("会把文章正文中的合法资源 URL 计入引用", async () => {
        mockedReadMany.mockImplementation((async (
            collection: string,
            query?: { fields?: string[]; offset?: number },
        ) => {
            if (collection === "app_site_settings") {
                return [];
            }
            if (
                collection === "app_articles" &&
                query?.fields?.includes("body_markdown")
            ) {
                return [
                    {
                        body_markdown: `![a](/api/v1/public/assets/${UUID_A})`,
                    },
                ] as never;
            }
            return [] as never;
        }) as typeof readMany);

        const referenced = await collectReferencedDirectusFileIds([
            UUID_A,
            UUID_B,
        ]);

        expect(referenced.has(UUID_A)).toBe(true);
        expect(referenced.has(UUID_B)).toBe(false);
    });
});

describe("cleanupOwnedOrphanDirectusFiles", () => {
    it("不会删除不属于当前用户的候选文件", async () => {
        mockedReadMany.mockImplementation((async (
            collection: string,
            query?: { fields?: string[]; filter?: Record<string, unknown> },
        ) => {
            if (
                collection === "directus_files" &&
                query?.fields?.includes("app_owner_user_id")
            ) {
                return [
                    {
                        id: UUID_A,
                        app_owner_user_id: "other-user",
                        uploaded_by: "other-user",
                    },
                ] as never;
            }
            if (collection === "app_site_settings") {
                return [] as never;
            }
            return [] as never;
        }) as typeof readMany);

        const deleted = await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [UUID_A],
            ownerUserIds: ["current-user"],
        });

        expect(deleted).toEqual([]);
        expect(mockedDeleteDirectusFile).not.toHaveBeenCalled();
    });

    it("只删除当前用户拥有且未被引用的文件", async () => {
        mockedReadMany.mockImplementation((async (
            collection: string,
            query?: { fields?: string[]; filter?: Record<string, unknown> },
        ) => {
            if (
                collection === "directus_files" &&
                query?.fields?.includes("app_owner_user_id")
            ) {
                return [
                    {
                        id: UUID_A,
                        app_owner_user_id: "user-1",
                        uploaded_by: "user-1",
                    },
                ] as never;
            }
            if (collection === "app_site_settings") {
                return [] as never;
            }
            return [] as never;
        }) as typeof readMany);

        const deleted = await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [UUID_A],
            ownerUserIds: ["user-1"],
        });

        expect(deleted).toEqual([UUID_A]);
        expect(mockedDeleteDirectusFile).toHaveBeenCalledWith(UUID_A);
        expect(mockedRunWithDirectusServiceAccess).toHaveBeenCalled();
    });

    it("支持多 owner 候选并在 service 作用域中执行扫描", async () => {
        mockedReadMany.mockImplementation((async (
            collection: string,
            query?: { fields?: string[]; filter?: Record<string, unknown> },
        ) => {
            if (
                collection === "directus_files" &&
                query?.fields?.includes("app_owner_user_id")
            ) {
                return [
                    {
                        id: UUID_A,
                        app_owner_user_id: "user-1",
                        uploaded_by: "user-1",
                    },
                    {
                        id: UUID_B,
                        app_owner_user_id: "user-2",
                        uploaded_by: "user-2",
                    },
                ] as never;
            }
            if (collection === "app_site_settings") {
                return [] as never;
            }
            return [] as never;
        }) as typeof readMany);

        const deleted = await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [UUID_A, UUID_B],
            ownerUserIds: ["user-1", "user-2"],
        });

        expect(deleted).toEqual([UUID_A, UUID_B]);
        expect(mockedDeleteDirectusFile).toHaveBeenNthCalledWith(1, UUID_A);
        expect(mockedDeleteDirectusFile).toHaveBeenNthCalledWith(2, UUID_B);
        expect(mockedRunWithDirectusServiceAccess).toHaveBeenCalled();
    });
});
