import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
    readMany: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    readMany: mocks.readMany,
    deleteDirectusFile: vi.fn(),
}));

import {
    STRUCTURED_REFERENCE_TARGETS,
    readAllReferencedIdsInSiteSettingsFromRepository,
    readOwnerSourceReferencedFileIdsFromRepository,
    readReferencedIdsInSiteSettingsFromRepository,
    readStaleFileGcCandidatesFromRepository,
} from "@/server/repositories/files/file-cleanup.repository";

const SITE_SETTINGS_REFERENCE_FIELDS = [
    "settings_site",
    "settings_nav",
    "settings_home",
    "settings_article",
    "settings_other",
] as const;

const UUID_A = "a1b2c3d4-e5f6-1234-9abc-def012345678";
const UUID_B = "f1e2d3c4-b5a6-4234-8abc-fedcba987654";
const UUID_C = "11111111-2222-4333-8abc-444444444444";

describe("file-cleanup.repository", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.PUBLIC_ASSET_BASE_URL;
        mocks.readMany.mockResolvedValue([]);
    });

    it("builds the GC candidate filters for quarantine and physical delete phases", async () => {
        await readStaleFileGcCandidatesFromRepository({
            detachedBefore: "2026-04-23T00:00:00.000Z",
            quarantinedBefore: "2026-04-30T00:00:00.000Z",
            deleteRetryBefore: "2026-05-01T00:00:00.000Z",
            limit: 200,
        });

        const fields = [
            "id",
            "date_created",
            "app_lifecycle",
            "app_detached_at",
            "app_quarantined_at",
            "app_deleted_at",
            "app_delete_attempts",
            "app_delete_next_retry_at",
            "app_delete_last_error",
            "app_delete_dead_lettered_at",
        ];

        expect(mocks.readMany).toHaveBeenNthCalledWith(1, "directus_files", {
            filter: {
                _and: [
                    { app_lifecycle: { _eq: "detached" } },
                    { app_detached_at: { _nnull: true } },
                    { app_detached_at: { _lte: "2026-04-23T00:00:00.000Z" } },
                ],
            },
            fields,
            sort: ["app_detached_at", "id"],
            limit: 200,
        });
        expect(mocks.readMany).toHaveBeenNthCalledWith(2, "directus_files", {
            filter: {
                _and: [
                    { app_lifecycle: { _eq: "quarantined" } },
                    { app_quarantined_at: { _nnull: true } },
                    {
                        app_quarantined_at: {
                            _lte: "2026-04-30T00:00:00.000Z",
                        },
                    },
                ],
            },
            fields,
            sort: ["app_quarantined_at", "id"],
            limit: 200,
        });
        expect(mocks.readMany).toHaveBeenNthCalledWith(3, "directus_files", {
            filter: {
                _and: [
                    { app_lifecycle: { _eq: "deleting" } },
                    {
                        _or: [
                            { app_delete_next_retry_at: { _null: true } },
                            {
                                app_delete_next_retry_at: {
                                    _lte: "2026-05-01T00:00:00.000Z",
                                },
                            },
                        ],
                    },
                ],
            },
            fields,
            sort: ["app_delete_next_retry_at", "app_deleted_at", "id"],
            limit: 200,
        });
        expect(mocks.readMany).toHaveBeenNthCalledWith(4, "directus_files", {
            filter: {
                _and: [
                    { app_lifecycle: { _eq: "deleted" } },
                    {
                        _or: [
                            { app_delete_next_retry_at: { _null: true } },
                            {
                                app_delete_next_retry_at: {
                                    _lte: "2026-05-01T00:00:00.000Z",
                                },
                            },
                        ],
                    },
                ],
            },
            fields,
            sort: ["app_delete_next_retry_at", "app_deleted_at", "id"],
            limit: 200,
        });
    });

    it("scans all site settings section fields for candidate file references", async () => {
        process.env.PUBLIC_ASSET_BASE_URL = "https://cdn.example.com/assets";
        mocks.readMany.mockResolvedValue([
            {
                settings_site: {
                    logo: UUID_A,
                },
                settings_nav: {
                    links: [
                        {
                            icon: { id: UUID_C },
                        },
                    ],
                },
                settings_home: null,
                settings_article: {
                    cover: "plain text without supported asset URL",
                },
                settings_other: {
                    footer: `https://cdn.example.com/assets/${UUID_B}?width=320`,
                },
            },
        ]);

        const referenced = await readReferencedIdsInSiteSettingsFromRepository([
            UUID_A,
            UUID_B,
            UUID_C,
        ]);

        expect(mocks.readMany).toHaveBeenCalledWith("app_site_settings", {
            filter: {
                _and: [
                    { key: { _eq: "default" } },
                    { status: { _eq: "published" } },
                ],
            },
            fields: [...SITE_SETTINGS_REFERENCE_FIELDS],
            sort: ["-date_updated", "-date_created"],
            limit: 1,
        });
        expect(referenced).toEqual(new Set([UUID_A, UUID_C, UUID_B]));
    });

    it("scans all site settings section fields for full reference collection", async () => {
        process.env.PUBLIC_ASSET_BASE_URL = "https://cdn.example.com/assets";
        mocks.readMany.mockResolvedValue([
            {
                settings_site: UUID_A,
                settings_nav: {
                    items: [{ id: UUID_B }],
                },
                settings_home: {
                    hero: {
                        image: `https://cdn.example.com/assets/${UUID_C}#hash`,
                    },
                },
                settings_article: null,
                settings_other: {
                    value: "plain text only",
                },
            },
        ]);

        const referenced =
            await readAllReferencedIdsInSiteSettingsFromRepository();

        expect(mocks.readMany).toHaveBeenCalledWith("app_site_settings", {
            filter: {
                _and: [
                    { key: { _eq: "default" } },
                    { status: { _eq: "published" } },
                ],
            },
            fields: [...SITE_SETTINGS_REFERENCE_FIELDS],
            sort: ["-date_updated", "-date_created"],
            limit: 1,
        });
        expect(referenced).toEqual(new Set([UUID_A, UUID_B, UUID_C]));
    });

    it("scans the owner source row when release candidates are missing from the reference table", async () => {
        mocks.readMany.mockImplementation(async (collection, query) => {
            if (
                collection === "app_articles" &&
                query?.fields?.includes("cover_file")
            ) {
                return [{ id: "article-1", cover_file: UUID_A }];
            }
            if (
                collection === "app_articles" &&
                query?.fields?.includes("body_markdown")
            ) {
                return [
                    {
                        id: "article-1",
                        body_markdown: `![cover](/api/v1/public/assets/${UUID_B}?width=960)`,
                    },
                ];
            }
            return [];
        });

        const referenced = await readOwnerSourceReferencedFileIdsFromRepository(
            {
                ownerCollection: "app_articles",
                ownerId: "article-1",
            },
        );

        expect(mocks.readMany).toHaveBeenCalledWith("app_articles", {
            filter: { id: { _eq: "article-1" } },
            fields: ["id", "cover_file"],
            limit: 1,
        });
        expect(mocks.readMany).toHaveBeenCalledWith("app_articles", {
            filter: { id: { _eq: "article-1" } },
            fields: ["id", "body_markdown"],
            limit: 1,
        });
        expect(referenced).toEqual([UUID_A, UUID_B]);
    });

    it("keeps every Directus file relation covered by structured reference targets", () => {
        type DirectusSchemaRelation = {
            collection?: unknown;
            field?: unknown;
            related_collection?: unknown;
        };
        const schema = JSON.parse(
            readFileSync("directus/schema/app-schema.json", "utf8"),
        ) as { relations?: DirectusSchemaRelation[] };
        const directusFileRelations = (schema.relations || [])
            .filter(
                (relation) =>
                    relation.related_collection === "directus_files" &&
                    typeof relation.collection === "string" &&
                    typeof relation.field === "string" &&
                    relation.collection.startsWith("app_") &&
                    relation.collection !== "app_file_references",
            )
            .map(
                (relation) =>
                    `${String(relation.collection)}.${String(relation.field)}`,
            )
            .sort();
        const structuredTargets = STRUCTURED_REFERENCE_TARGETS.map(
            (target) => `${target.collection}.${target.field}`,
        ).sort();

        expect(structuredTargets).toEqual(
            expect.arrayContaining(directusFileRelations),
        );
        expect(directusFileRelations).toEqual([
            "app_album_photos.file_id",
            "app_albums.cover_file",
            "app_anime_entries.cover_file",
            "app_articles.cover_file",
            "app_diary_images.file_id",
            "app_friends.avatar_file",
            "app_user_profiles.header_file",
            "app_user_registration_requests.avatar_file",
        ]);
    });

    it("keeps GC and reference lookup fields indexed in the Directus schema", () => {
        type DirectusSchemaField = {
            collection?: unknown;
            field?: unknown;
            schema?: { is_indexed?: unknown };
        };
        const schema = JSON.parse(
            readFileSync("directus/schema/app-schema.json", "utf8"),
        ) as { fields?: DirectusSchemaField[] };
        const indexedFields = new Set(
            (schema.fields || [])
                .filter((field) => field.schema?.is_indexed === true)
                .map(
                    (field) =>
                        `${String(field.collection)}.${String(field.field)}`,
                ),
        );
        const requiredIndexes = [
            "app_file_detach_jobs.status",
            "app_file_detach_jobs.source_type",
            "app_file_detach_jobs.source_id",
            "app_file_detach_jobs.scheduled_at",
            "app_file_detach_jobs.leased_until",
            "app_file_references.file_id",
            "app_file_references.owner_collection",
            "app_file_references.owner_id",
            "app_file_references.owner_field",
            "app_file_references.reference_kind",
            "app_file_references.owner_user_id",
            "directus_files.app_owner_user_id",
            "directus_files.app_lifecycle",
            "directus_files.app_detached_at",
            "directus_files.app_quarantined_at",
            "directus_files.app_deleted_at",
            "directus_files.app_delete_next_retry_at",
        ];

        expect(
            requiredIndexes.filter((field) => !indexedFields.has(field)),
        ).toEqual([]);
    });
});
