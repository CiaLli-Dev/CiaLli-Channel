import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createOne: vi.fn(),
    deleteOne: vi.fn(),
    readMany: vi.fn(),
    updateOne: vi.fn(),
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/directus/client", () => ({
    createOne: mocks.createOne,
    deleteOne: mocks.deleteOne,
    readMany: mocks.readMany,
    updateOne: mocks.updateOne,
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: mocks.withServiceRepositoryContext,
}));

import {
    buildFileReferenceId,
    deleteOwnerReferences,
    readAllReferencedFileIdsFromReferenceTable,
    readFileReferencesByFileIds,
    replaceOwnerFieldReferences,
} from "@/server/repositories/files/file-reference.repository";
import { AppError } from "@/server/api/errors";

const FILE_KEEP = "11111111-1111-4111-8111-111111111111";
const FILE_NEW = "22222222-2222-4222-8222-222222222222";
const FILE_STALE = "33333333-3333-4333-8333-333333333333";

describe("file-reference.repository", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createOne.mockResolvedValue({ id: "created" });
        mocks.updateOne.mockResolvedValue({ id: "updated" });
        mocks.deleteOne.mockResolvedValue(undefined);
        mocks.readMany.mockResolvedValue([]);
    });

    it("builds stable deterministic ids for the same owner/file tuple", () => {
        const first = buildFileReferenceId({
            fileId: FILE_KEEP,
            ownerCollection: "app_articles",
            ownerId: "article-1",
            ownerField: "body_markdown",
            referenceKind: "markdown_asset",
        });
        const second = buildFileReferenceId({
            fileId: FILE_KEEP,
            ownerCollection: "app_articles",
            ownerId: "article-1",
            ownerField: "body_markdown",
            referenceKind: "markdown_asset",
        });

        expect(first).toBe(second);
        expect(first).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    it("creates, updates, and deletes references for one owner field", async () => {
        const keepId = buildFileReferenceId({
            fileId: FILE_KEEP,
            ownerCollection: "app_articles",
            ownerId: "article-1",
            ownerField: "body_markdown",
            referenceKind: "markdown_asset",
        });
        mocks.readMany.mockResolvedValue([
            {
                id: keepId,
                file_id: FILE_KEEP,
                owner_user_id: "old-user",
                visibility: "private",
            },
            {
                id: "stale-reference",
                file_id: FILE_STALE,
                owner_user_id: "user-1",
                visibility: "public",
            },
        ]);

        const result = await replaceOwnerFieldReferences(
            {
                ownerCollection: "app_articles",
                ownerId: "article-1",
                ownerField: "body_markdown",
                referenceKind: "markdown_asset",
                fileIds: [FILE_KEEP, FILE_NEW, FILE_NEW],
                ownerUserId: "user-1",
                visibility: "public",
            },
            new Date("2026-04-25T00:00:00.000Z"),
        );

        expect(mocks.createOne).toHaveBeenCalledTimes(1);
        expect(mocks.createOne).toHaveBeenCalledWith(
            "app_file_references",
            expect.objectContaining({
                file_id: FILE_NEW,
                owner_collection: "app_articles",
                owner_id: "article-1",
                owner_field: "body_markdown",
                reference_kind: "markdown_asset",
                owner_user_id: "user-1",
                visibility: "public",
            }),
            { fields: ["id"] },
        );
        expect(mocks.updateOne).toHaveBeenCalledWith(
            "app_file_references",
            keepId,
            {
                owner_user_id: "user-1",
                visibility: "public",
                updated_at: "2026-04-25T00:00:00.000Z",
            },
        );
        expect(mocks.deleteOne).toHaveBeenCalledWith(
            "app_file_references",
            "stale-reference",
        );
        expect(result).toMatchObject({
            created: 1,
            updated: 1,
            deleted: 1,
            fileIds: [FILE_KEEP, FILE_NEW],
        });
    });

    it("treats duplicate deterministic reference creates as idempotent", async () => {
        mocks.readMany.mockResolvedValue([]);
        mocks.createOne.mockRejectedValueOnce(
            new AppError(
                "DIRECTUS_ERROR",
                '[directus/client] 创建集合 app_file_references 数据失败 (400) codes=RECORD_NOT_UNIQUE: RECORD_NOT_UNIQUE:Value "ref" for field "id" in collection "app_file_references" has to be unique.',
                400,
            ),
        );

        await expect(
            replaceOwnerFieldReferences({
                ownerCollection: "app_articles",
                ownerId: "article-1",
                ownerField: "body_markdown",
                referenceKind: "markdown_asset",
                fileIds: [FILE_NEW],
                ownerUserId: "user-1",
                visibility: "public",
            }),
        ).resolves.toMatchObject({
            created: 0,
            updated: 0,
            deleted: 0,
            fileIds: [FILE_NEW],
        });
    });

    it("deletes every reference owned by an item", async () => {
        mocks.readMany.mockResolvedValue([{ id: "ref-1" }, { id: "ref-2" }]);

        await expect(
            deleteOwnerReferences({
                ownerCollection: "app_articles",
                ownerId: "article-1",
            }),
        ).resolves.toBe(2);

        expect(mocks.deleteOne).toHaveBeenCalledTimes(2);
    });

    it("reads all distinct referenced file ids from the table", async () => {
        mocks.readMany.mockResolvedValueOnce([
            { file_id: FILE_KEEP },
            { file_id: FILE_NEW },
            { file_id: FILE_KEEP },
            { file_id: null },
        ]);

        await expect(
            readAllReferencedFileIdsFromReferenceTable(),
        ).resolves.toEqual(new Set([FILE_KEEP, FILE_NEW]));
    });

    it("reads full reference rows for candidate file ids", async () => {
        mocks.readMany.mockResolvedValueOnce([
            {
                id: "ref-1",
                file_id: FILE_KEEP,
                owner_collection: "app_articles",
                owner_id: "article-1",
                owner_field: "body_markdown",
                reference_kind: "markdown_asset",
                owner_user_id: "user-1",
                visibility: "public",
            },
        ]);

        await expect(
            readFileReferencesByFileIds([FILE_KEEP, FILE_KEEP, "invalid"]),
        ).resolves.toEqual([
            expect.objectContaining({
                id: "ref-1",
                file_id: FILE_KEEP,
                owner_user_id: "user-1",
                visibility: "public",
            }),
        ]);
        expect(mocks.readMany).toHaveBeenCalledWith("app_file_references", {
            filter: { file_id: { _in: [FILE_KEEP] } },
            fields: [
                "id",
                "file_id",
                "owner_collection",
                "owner_id",
                "owner_field",
                "reference_kind",
                "owner_user_id",
                "visibility",
            ],
            limit: 500,
            offset: 0,
        });
    });
});
