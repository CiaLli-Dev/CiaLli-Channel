import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/files/file-cleanup.repository", () => ({
    readAllReferencedIdsInSiteSettingsFromRepository: vi.fn(),
    readAllReferencedIdsInStructuredTargetFromRepository: vi.fn(),
    readAllReferencedIdsInMarkdownTargetFromRepository: vi.fn(),
    readReferencedIdsInSiteSettingsFromRepository: vi.fn(),
    readReferencedIdsInStructuredTargetFromRepository: vi.fn(),
    readReferencedIdsInMarkdownTargetFromRepository: vi.fn(),
    STRUCTURED_REFERENCE_TARGETS: [
        { collection: "app_user_profiles", field: "header_file" },
        { collection: "app_articles", field: "cover_file" },
        { collection: "app_albums", field: "cover_file" },
        { collection: "app_anime_entries", field: "cover_file" },
        { collection: "app_friends", field: "avatar_file" },
        { collection: "app_album_photos", field: "file_id" },
        { collection: "app_diary_images", field: "file_id" },
        { collection: "app_user_registration_requests", field: "avatar_file" },
        { collection: "directus_users", field: "avatar" },
    ],
    MARKDOWN_REFERENCE_TARGETS: [
        { collection: "app_articles", field: "body_markdown" },
        { collection: "app_article_comments", field: "body" },
        { collection: "app_diary_comments", field: "body" },
        { collection: "app_diaries", field: "content" },
        { collection: "app_site_announcements", field: "body_markdown" },
    ],
    readFileIdsFromCollectionFieldFromRepository: vi.fn(),
    readOwnedDirectusFileIdsFromRepository: vi.fn(),
    readDirectusUserAvatarFileIdsFromRepository: vi.fn(),
    readRelationFileIdsFromRepository: vi.fn(),
    readOwnerIdsFromRepository: vi.fn(),
    readCommentCleanupCandidatesFromRepository: vi.fn(),
    readDiaryImageFileIdsFromRepository: vi.fn(),
    readAlbumPhotoFileIdsFromRepository: vi.fn(),
}));

vi.mock("@/server/repositories/files/file-reference.repository", () => ({
    readAllReferencedFileIdsFromReferenceTable: vi.fn(),
    readReferencedFileIdsFromReferenceTable: vi.fn(),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

import {
    collectLegacyScannedReferencedDirectusFileIdsForCandidates,
    collectReferencedDirectusFileIds,
    extractDirectusAssetIdsFromMarkdown,
    extractDirectusFileIdsFromUnknown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup";
import {
    readReferencedIdsInSiteSettingsFromRepository,
    readReferencedIdsInStructuredTargetFromRepository,
    readReferencedIdsInMarkdownTargetFromRepository,
} from "@/server/repositories/files/file-cleanup.repository";
import { readReferencedFileIdsFromReferenceTable } from "@/server/repositories/files/file-reference.repository";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";

const mockedReadReferencedIdsInSiteSettings = vi.mocked(
    readReferencedIdsInSiteSettingsFromRepository,
);
const mockedReadReferencedIdsInStructuredTarget = vi.mocked(
    readReferencedIdsInStructuredTargetFromRepository,
);
const mockedReadReferencedIdsInMarkdownTarget = vi.mocked(
    readReferencedIdsInMarkdownTargetFromRepository,
);
const mockedReadReferencedFileIdsFromReferenceTable = vi.mocked(
    readReferencedFileIdsFromReferenceTable,
);
const mockedWithServiceRepositoryContext = vi.mocked(
    withServiceRepositoryContext,
);

const UUID_A = "a1b2c3d4-e5f6-1234-9abc-def012345678";
const UUID_B = "f1e2d3c4-b5a6-4234-8abc-fedcba987654";

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PUBLIC_ASSET_BASE_URL;
    mockedReadReferencedFileIdsFromReferenceTable.mockResolvedValue(new Set());
    mockedReadReferencedIdsInSiteSettings.mockResolvedValue(new Set());
    mockedReadReferencedIdsInStructuredTarget.mockResolvedValue(new Set());
    mockedReadReferencedIdsInMarkdownTarget.mockResolvedValue(new Set());
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
                `![a](/api/v1/public/assets/${UUID_A}) ![b](/api/v1/assets/${UUID_B}?width=320) ![c](/assets/${UUID_A})`,
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
                `![cdn](https://cdn.example.com/assets/${UUID_A}?format=webp)`,
            ),
        ).toEqual([UUID_A]);
    });
});

describe("extractDirectusFileIdsFromUnknown", () => {
    it("支持结构化 settings 中的多种 Directus 文件引用格式", () => {
        process.env.PUBLIC_ASSET_BASE_URL = "https://cdn.example.com/assets";

        expect(
            extractDirectusFileIdsFromUnknown(
                {
                    bare: UUID_A,
                    direct: `/assets/${UUID_B}`,
                    privateUrl: `/api/v1/assets/${UUID_A}?width=320`,
                    publicUrl: `/api/v1/public/assets/${UUID_B}`,
                    cdnUrl: `https://cdn.example.com/assets/${UUID_A}?format=webp`,
                    object: { id: UUID_B.toUpperCase() },
                    nested: [`https://example.com/assets/${UUID_A}`],
                },
                { includeBareUuid: true },
            ),
        ).toEqual([UUID_A, UUID_B]);
    });

    it("默认不把普通文本里的裸 UUID 当作文件引用", () => {
        expect(
            extractDirectusFileIdsFromUnknown(`plain uuid ${UUID_A}`),
        ).toEqual([]);
    });
});

describe("collectReferencedDirectusFileIds", () => {
    it("合并 app_file_references 与 legacy 字段扫描结果", async () => {
        mockedReadReferencedFileIdsFromReferenceTable.mockResolvedValue(
            new Set([UUID_A]),
        );
        mockedReadReferencedIdsInMarkdownTarget.mockResolvedValue(
            new Set([UUID_B]),
        );

        const referenced = await collectReferencedDirectusFileIds([
            UUID_A,
            UUID_B,
        ]);

        expect(referenced.has(UUID_A)).toBe(true);
        expect(referenced.has(UUID_B)).toBe(true);
        expect(mockedReadReferencedIdsInMarkdownTarget).toHaveBeenCalled();
        expect(
            mockedReadReferencedFileIdsFromReferenceTable,
        ).toHaveBeenCalledWith([UUID_A, UUID_B]);
    });

    it("保留 legacy 候选扫描作为回填和校验工具", async () => {
        mockedReadReferencedIdsInSiteSettings.mockResolvedValue(new Set());
        mockedReadReferencedIdsInStructuredTarget.mockImplementation(
            async (target) => {
                if (
                    target.collection === "app_anime_entries" &&
                    target.field === "cover_file"
                ) {
                    return new Set([UUID_B]);
                }
                return new Set();
            },
        );
        mockedReadReferencedIdsInMarkdownTarget.mockResolvedValue(new Set());

        const referenced =
            await collectLegacyScannedReferencedDirectusFileIdsForCandidates([
                UUID_A,
                UUID_B,
            ]);

        expect(referenced.has(UUID_A)).toBe(false);
        expect(referenced.has(UUID_B)).toBe(true);
    });

    it("在 service 作用域中执行引用扫描", async () => {
        mockedReadReferencedIdsInSiteSettings.mockResolvedValue(new Set());
        mockedReadReferencedIdsInStructuredTarget.mockResolvedValue(new Set());
        mockedReadReferencedIdsInMarkdownTarget.mockResolvedValue(new Set());

        await collectReferencedDirectusFileIds([UUID_A]);

        expect(mockedWithServiceRepositoryContext).toHaveBeenCalled();
    });
});
