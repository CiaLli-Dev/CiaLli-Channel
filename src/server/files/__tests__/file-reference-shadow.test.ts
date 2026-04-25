import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    collectLegacyScannedReferencedDirectusFileIds: vi.fn(),
    countFileReferencesFromRepository: vi.fn(),
    readAllReferencedFileIdsFromReferenceTable: vi.fn(),
    replaceOwnerFieldReferences: vi.fn(),
    readMany: vi.fn(),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: mocks.withServiceRepositoryContext,
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    collectLegacyScannedReferencedDirectusFileIds:
        mocks.collectLegacyScannedReferencedDirectusFileIds,
}));

vi.mock("@/server/repositories/files/file-reference.repository", () => ({
    countFileReferencesFromRepository: mocks.countFileReferencesFromRepository,
    readAllReferencedFileIdsFromReferenceTable:
        mocks.readAllReferencedFileIdsFromReferenceTable,
    replaceOwnerFieldReferences: mocks.replaceOwnerFieldReferences,
}));

vi.mock("@/server/directus/client", () => ({
    readMany: mocks.readMany,
}));

import {
    readFileReferenceShadowIntervalMs,
    runFileReferenceShadowComparison,
} from "@/server/files/file-reference-shadow";

const FILE_COVER = "11111111-1111-4111-8111-111111111111";
const FILE_BODY = "22222222-2222-4222-8222-222222222222";
const FILE_LEGACY = "33333333-3333-4333-8333-333333333333";
const FILE_TABLE = "44444444-4444-4444-8444-444444444444";

describe("file-reference-shadow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.FILE_REFERENCE_SHADOW_INTERVAL_MS;
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        mocks.countFileReferencesFromRepository.mockResolvedValue(1);
        mocks.collectLegacyScannedReferencedDirectusFileIds.mockResolvedValue(
            new Set(),
        );
        mocks.readAllReferencedFileIdsFromReferenceTable.mockResolvedValue(
            new Set(),
        );
        mocks.replaceOwnerFieldReferences.mockResolvedValue({
            created: 0,
            updated: 0,
            deleted: 0,
            fileIds: [],
        });
        mocks.readMany.mockResolvedValue([]);
    });

    it("uses the default daily interval", () => {
        expect(readFileReferenceShadowIntervalMs()).toBe(86_400_000);
    });

    it("logs matched when legacy and table file ids agree", async () => {
        mocks.collectLegacyScannedReferencedDirectusFileIds.mockResolvedValue(
            new Set([FILE_COVER]),
        );
        mocks.readAllReferencedFileIdsFromReferenceTable.mockResolvedValue(
            new Set([FILE_COVER]),
        );

        const result = await runFileReferenceShadowComparison();

        expect(console.info).toHaveBeenCalledWith(
            "[file-reference-shadow] matched",
            expect.objectContaining({
                event: "file_reference_shadow_compare",
                legacyCount: 1,
                tableCount: 1,
                missingInTableCount: 0,
                extraInTableCount: 0,
            }),
        );
        expect(console.error).not.toHaveBeenCalled();
        expect(result.missingInTable).toEqual([]);
    });

    it("logs mismatch samples without throwing", async () => {
        mocks.collectLegacyScannedReferencedDirectusFileIds.mockResolvedValue(
            new Set([FILE_LEGACY]),
        );
        mocks.readAllReferencedFileIdsFromReferenceTable.mockResolvedValue(
            new Set([FILE_TABLE]),
        );

        const result = await runFileReferenceShadowComparison();

        expect(console.error).toHaveBeenCalledWith(
            "[file-reference-shadow] mismatch",
            expect.objectContaining({
                missingInTableCount: 1,
                extraInTableCount: 1,
                missingInTableSample: [FILE_LEGACY],
                extraInTableSample: [FILE_TABLE],
            }),
        );
        expect(result).toMatchObject({
            missingInTable: [FILE_LEGACY],
            extraInTable: [FILE_TABLE],
        });
    });

    it("seeds references only when the table is empty", async () => {
        mocks.countFileReferencesFromRepository.mockResolvedValue(0);
        mocks.readMany.mockImplementation(async (collection: string) => {
            if (collection === "app_articles") {
                return [
                    {
                        id: "article-1",
                        cover_file: FILE_COVER,
                        body_markdown: `![x](/api/v1/public/assets/${FILE_BODY})`,
                        author_id: "user-1",
                        status: "published",
                        is_public: true,
                    },
                ];
            }
            return [];
        });

        await runFileReferenceShadowComparison();

        expect(mocks.replaceOwnerFieldReferences).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerCollection: "app_articles",
                ownerId: "article-1",
                ownerField: "cover_file",
                referenceKind: "structured_field",
                fileIds: [FILE_COVER],
            }),
        );
        expect(mocks.replaceOwnerFieldReferences).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerCollection: "app_articles",
                ownerId: "article-1",
                ownerField: "body_markdown",
                referenceKind: "markdown_asset",
                fileIds: [FILE_BODY],
            }),
        );
    });
});
