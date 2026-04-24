import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    readMany: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    readMany: mocks.readMany,
    deleteDirectusFile: vi.fn(),
}));

import {
    readAllReferencedIdsInSiteSettingsFromRepository,
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
        mocks.readMany.mockResolvedValue([]);
    });

    it("builds the GC candidate filters for expired detached and temporary files", async () => {
        await readStaleFileGcCandidatesFromRepository({
            detachedBefore: "2026-04-23T00:00:00.000Z",
            limit: 200,
        });

        expect(mocks.readMany).toHaveBeenNthCalledWith(1, "directus_files", {
            filter: {
                _and: [
                    { app_lifecycle: { _eq: "detached" } },
                    { app_detached_at: { _nnull: true } },
                    { app_detached_at: { _lte: "2026-04-23T00:00:00.000Z" } },
                ],
            },
            fields: ["id", "date_created", "app_lifecycle", "app_detached_at"],
            sort: ["app_detached_at", "id"],
            limit: 200,
        });
        expect(mocks.readMany).toHaveBeenNthCalledWith(2, "directus_files", {
            filter: {
                _and: [
                    { app_lifecycle: { _eq: "temporary" } },
                    { date_created: { _nnull: true } },
                    { date_created: { _lte: "2026-04-23T00:00:00.000Z" } },
                ],
            },
            fields: ["id", "date_created", "app_lifecycle", "app_detached_at"],
            sort: ["date_created", "id"],
            limit: 200,
        });
    });

    it("scans all site settings section fields for candidate file references", async () => {
        mocks.readMany.mockResolvedValue([
            {
                settings_site: {
                    logo: `![logo](/api/v1/public/assets/${UUID_A})`,
                },
                settings_nav: {
                    links: [
                        {
                            icon: `![ignored](/api/v1/public/assets/${UUID_C})`,
                        },
                    ],
                },
                settings_home: null,
                settings_article: {
                    cover: "plain text without supported asset URL",
                },
                settings_other: {
                    footer: `![footer](/api/v1/assets/${UUID_B}?width=320)`,
                },
            },
        ]);

        const referenced = await readReferencedIdsInSiteSettingsFromRepository([
            UUID_A,
            UUID_B,
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
        expect(referenced).toEqual(new Set([UUID_A, UUID_B]));
    });

    it("scans all site settings section fields for full reference collection", async () => {
        mocks.readMany.mockResolvedValue([
            {
                settings_site: `![logo](/api/v1/public/assets/${UUID_A})`,
                settings_nav: {
                    items: [`![nav](/api/v1/assets/${UUID_B})`],
                },
                settings_home: {
                    hero: {
                        image: `![hero](/api/v1/public/assets/${UUID_C}#hash)`,
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
});
