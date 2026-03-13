import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/files/file-cleanup.repository", () => ({
    readReferencedIdsInSiteSettingsFromRepository: vi.fn(),
    readReferencedIdsInStructuredTargetFromRepository: vi.fn(),
    readReferencedIdsInMarkdownTargetFromRepository: vi.fn(),
    readDeletableOwnedFilesFromRepository: vi.fn(),
    deleteOrphanFileFromRepository: vi.fn().mockResolvedValue(undefined),
    STRUCTURED_REFERENCE_TARGETS: [
        { collection: "app_user_profiles", field: "header_file" },
        { collection: "app_articles", field: "cover_file" },
        { collection: "app_albums", field: "cover_file" },
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

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: vi.fn(
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
    readReferencedIdsInSiteSettingsFromRepository,
    readReferencedIdsInStructuredTargetFromRepository,
    readReferencedIdsInMarkdownTargetFromRepository,
    readDeletableOwnedFilesFromRepository,
    deleteOrphanFileFromRepository,
} from "@/server/repositories/files/file-cleanup.repository";
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
const mockedReadDeletableOwnedFiles = vi.mocked(
    readDeletableOwnedFilesFromRepository,
);
const mockedDeleteOrphanFile = vi.mocked(deleteOrphanFileFromRepository);
const mockedWithServiceRepositoryContext = vi.mocked(
    withServiceRepositoryContext,
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
        mockedReadReferencedIdsInSiteSettings.mockResolvedValue(new Set());
        mockedReadReferencedIdsInStructuredTarget.mockResolvedValue(new Set());
        mockedReadReferencedIdsInMarkdownTarget.mockImplementation(
            async (target) => {
                if (
                    target.collection === "app_articles" &&
                    target.field === "body_markdown"
                ) {
                    return new Set([UUID_A]);
                }
                return new Set();
            },
        );

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
        mockedReadDeletableOwnedFiles.mockResolvedValue([]);

        const deleted = await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [UUID_A],
            ownerUserIds: ["current-user"],
        });

        expect(deleted).toEqual([]);
        expect(mockedDeleteOrphanFile).not.toHaveBeenCalled();
    });

    it("只删除当前用户拥有且未被引用的文件", async () => {
        mockedReadDeletableOwnedFiles.mockResolvedValue([UUID_A]);
        mockedReadReferencedIdsInSiteSettings.mockResolvedValue(new Set());
        mockedReadReferencedIdsInStructuredTarget.mockResolvedValue(new Set());
        mockedReadReferencedIdsInMarkdownTarget.mockResolvedValue(new Set());

        const deleted = await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [UUID_A],
            ownerUserIds: ["user-1"],
        });

        expect(deleted).toEqual([UUID_A]);
        expect(mockedDeleteOrphanFile).toHaveBeenCalledWith(UUID_A);
        expect(mockedWithServiceRepositoryContext).toHaveBeenCalled();
    });

    it("支持多 owner 候选并在 service 作用域中执行扫描", async () => {
        mockedReadDeletableOwnedFiles.mockResolvedValue([UUID_A, UUID_B]);
        mockedReadReferencedIdsInSiteSettings.mockResolvedValue(new Set());
        mockedReadReferencedIdsInStructuredTarget.mockResolvedValue(new Set());
        mockedReadReferencedIdsInMarkdownTarget.mockResolvedValue(new Set());

        const deleted = await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [UUID_A, UUID_B],
            ownerUserIds: ["user-1", "user-2"],
        });

        expect(deleted).toEqual([UUID_A, UUID_B]);
        expect(mockedDeleteOrphanFile).toHaveBeenNthCalledWith(1, UUID_A);
        expect(mockedDeleteOrphanFile).toHaveBeenNthCalledWith(2, UUID_B);
        expect(mockedWithServiceRepositoryContext).toHaveBeenCalled();
    });

    it("仅以当前生效站点设置判断引用，忽略历史记录中的旧引用", async () => {
        mockedReadDeletableOwnedFiles.mockResolvedValue([UUID_A]);
        mockedReadReferencedIdsInSiteSettings.mockResolvedValue(new Set());
        mockedReadReferencedIdsInStructuredTarget.mockResolvedValue(new Set());
        mockedReadReferencedIdsInMarkdownTarget.mockResolvedValue(new Set());

        const deleted = await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [UUID_A],
            ownerUserIds: ["admin-1"],
        });

        expect(deleted).toEqual([UUID_A]);
        expect(mockedDeleteOrphanFile).toHaveBeenCalledWith(UUID_A);
    });
});
