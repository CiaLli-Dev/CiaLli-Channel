import type { JsonObject } from "@/types/json";
import { collectLegacyScannedReferencedDirectusFileIds } from "@/server/api/v1/shared/file-cleanup";
import {
    collectReferencedAssetIdsFromUnknown,
    MARKDOWN_REFERENCE_TARGETS,
    STRUCTURED_REFERENCE_TARGETS,
} from "@/server/repositories/files/file-cleanup.repository";
import {
    countFileReferencesFromRepository,
    readAllReferencedFileIdsFromReferenceTable,
    replaceOwnerFieldReferences,
    type FileReferenceKind,
    type FileReferenceVisibility,
} from "@/server/repositories/files/file-reference.repository";
import { readMany } from "@/server/directus/client";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { extractDirectusAssetIdsFromMarkdown } from "@/server/api/v1/shared/file-cleanup-reference-utils";

const DEFAULT_FILE_REFERENCE_SHADOW_INTERVAL_MS = 86_400_000;
const SHADOW_DIFF_SAMPLE_LIMIT = 50;
const BACKFILL_PAGE_SIZE = 200;

const SITE_SETTINGS_REFERENCE_FIELDS = [
    "settings_site",
    "settings_nav",
    "settings_home",
    "settings_article",
    "settings_other",
] as const;

type BackfillReference = {
    ownerCollection: string;
    ownerId: string;
    ownerField: string;
    referenceKind: FileReferenceKind;
    fileIds: string[];
    ownerUserId: string | null;
    visibility: FileReferenceVisibility;
};

function readPositiveIntegerEnv(
    value: string | undefined,
    fallback: number,
): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

export function readFileReferenceShadowIntervalMs(): number {
    return readPositiveIntegerEnv(
        process.env.FILE_REFERENCE_SHADOW_INTERVAL_MS ||
            import.meta.env.FILE_REFERENCE_SHADOW_INTERVAL_MS,
        DEFAULT_FILE_REFERENCE_SHADOW_INTERVAL_MS,
    );
}

function normalizeId(value: unknown): string | null {
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized || null;
    }
    if (value && typeof value === "object") {
        return normalizeId((value as { id?: unknown }).id);
    }
    return null;
}

function diffSets(left: Set<string>, right: Set<string>): string[] {
    return [...left].filter((item) => !right.has(item)).sort();
}

function readOwnerUserId(row: Record<string, unknown>): string | null {
    return (
        normalizeId(row.author_id) ||
        normalizeId(row.user_id) ||
        normalizeId(row.pending_user_id) ||
        normalizeId(row.uploaded_by) ||
        (row.id && row.owner_collection === "directus_users"
            ? normalizeId(row.id)
            : null)
    );
}

function resolveVisibility(
    row: Record<string, unknown>,
): FileReferenceVisibility {
    if (row.app_visibility === "public") {
        return "public";
    }
    if (row.is_public === true || row.profile_public === true) {
        return "public";
    }
    if (row.status === "published" && row.praviate === true) {
        return "public";
    }
    return "private";
}

function buildStructuredBackfillFields(
    collection: string,
    field: string,
): string[] {
    const common = ["id", field, "status"];
    if (collection === "directus_users") {
        return ["id", field];
    }
    if (collection === "app_user_profiles") {
        return [...common, "user_id", "profile_public"];
    }
    if (
        collection === "app_articles" ||
        collection === "app_albums" ||
        collection === "app_anime_entries"
    ) {
        return [...common, "author_id", "is_public"];
    }
    if (collection === "app_friends") {
        return ["id", field, "is_public"];
    }
    if (
        collection === "app_diary_images" ||
        collection === "app_album_photos"
    ) {
        return [...common, "is_public"];
    }
    if (collection === "app_user_registration_requests") {
        return [...common, "pending_user_id"];
    }
    return common;
}

function buildMarkdownBackfillFields(
    collection: string,
    field: string,
): string[] {
    const common = ["id", field, "status"];
    if (collection === "app_articles") {
        return [...common, "author_id", "is_public"];
    }
    if (collection === "app_diaries") {
        return [...common, "author_id", "praviate"];
    }
    if (
        collection === "app_article_comments" ||
        collection === "app_diary_comments"
    ) {
        return [...common, "author_id", "is_public"];
    }
    return common;
}

function buildReference(input: BackfillReference): BackfillReference | null {
    const ownerId = input.ownerId.trim();
    if (!ownerId || input.fileIds.length === 0) {
        return null;
    }
    return { ...input, ownerId };
}

async function collectStructuredBackfillReferences(): Promise<
    BackfillReference[]
> {
    const references: BackfillReference[] = [];
    for (const target of STRUCTURED_REFERENCE_TARGETS) {
        let offset = 0;
        while (true) {
            const rows = (await readMany(target.collection, {
                fields: buildStructuredBackfillFields(
                    target.collection,
                    target.field,
                ),
                limit: BACKFILL_PAGE_SIZE,
                offset,
            })) as Array<Record<string, unknown>>;
            for (const row of rows) {
                const fileIds = new Set<string>();
                collectReferencedAssetIdsFromUnknown(
                    row[target.field],
                    null,
                    fileIds,
                );
                const reference = buildReference({
                    ownerCollection: target.collection,
                    ownerId: normalizeId(row.id) || "",
                    ownerField: target.field,
                    referenceKind: "structured_field",
                    fileIds: [...fileIds],
                    ownerUserId:
                        target.collection === "directus_users"
                            ? normalizeId(row.id)
                            : readOwnerUserId(row),
                    visibility: resolveVisibility(row),
                });
                if (reference) {
                    references.push(reference);
                }
            }
            if (rows.length < BACKFILL_PAGE_SIZE) {
                break;
            }
            offset += rows.length;
        }
    }
    return references;
}

async function collectMarkdownBackfillReferences(): Promise<
    BackfillReference[]
> {
    const references: BackfillReference[] = [];
    for (const target of MARKDOWN_REFERENCE_TARGETS) {
        let offset = 0;
        while (true) {
            const rows = (await readMany(target.collection, {
                fields: buildMarkdownBackfillFields(
                    target.collection,
                    target.field,
                ),
                limit: BACKFILL_PAGE_SIZE,
                offset,
            })) as Array<Record<string, unknown>>;
            for (const row of rows) {
                const reference = buildReference({
                    ownerCollection: target.collection,
                    ownerId: normalizeId(row.id) || "",
                    ownerField: target.field,
                    referenceKind: "markdown_asset",
                    fileIds: extractDirectusAssetIdsFromMarkdown(
                        typeof row[target.field] === "string"
                            ? String(row[target.field])
                            : null,
                    ),
                    ownerUserId: readOwnerUserId(row),
                    visibility: resolveVisibility(row),
                });
                if (reference) {
                    references.push(reference);
                }
            }
            if (rows.length < BACKFILL_PAGE_SIZE) {
                break;
            }
            offset += rows.length;
        }
    }
    return references;
}

async function collectSiteSettingsBackfillReferences(): Promise<
    BackfillReference[]
> {
    const rows = (await readMany("app_site_settings", {
        filter: {
            _and: [
                { key: { _eq: "default" } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject,
        fields: [...SITE_SETTINGS_REFERENCE_FIELDS],
        sort: ["-date_updated", "-date_created"],
        limit: 1,
    })) as Array<Record<string, unknown>>;
    const references: BackfillReference[] = [];
    const row = rows[0];
    if (!row) {
        return references;
    }
    const fileIds = new Set<string>();
    for (const field of SITE_SETTINGS_REFERENCE_FIELDS) {
        collectReferencedAssetIdsFromUnknown(row[field], null, fileIds);
    }
    const reference = buildReference({
        ownerCollection: "app_site_settings",
        ownerId: "default",
        ownerField: "settings",
        referenceKind: "settings_asset",
        fileIds: [...fileIds],
        ownerUserId: null,
        visibility: "public",
    });
    return reference ? [reference] : [];
}

export async function seedFileReferencesWhenEmpty(): Promise<number> {
    return await withServiceRepositoryContext(async () => {
        if ((await countFileReferencesFromRepository()) > 0) {
            return 0;
        }
        const references = [
            ...(await collectStructuredBackfillReferences()),
            ...(await collectMarkdownBackfillReferences()),
            ...(await collectSiteSettingsBackfillReferences()),
        ];
        let written = 0;
        for (const reference of references) {
            const result = await replaceOwnerFieldReferences(reference);
            written += result.fileIds.length;
        }
        return written;
    });
}

export async function runFileReferenceShadowComparison(): Promise<{
    legacyCount: number;
    tableCount: number;
    missingInTable: string[];
    extraInTable: string[];
}> {
    return await withServiceRepositoryContext(async () => {
        const seeded = await seedFileReferencesWhenEmpty();
        const [legacyFileIds, tableFileIds] = await Promise.all([
            collectLegacyScannedReferencedDirectusFileIds(),
            readAllReferencedFileIdsFromReferenceTable(),
        ]);
        const missingInTable = diffSets(legacyFileIds, tableFileIds);
        const extraInTable = diffSets(tableFileIds, legacyFileIds);
        const payload = {
            event: "file_reference_shadow_compare",
            seeded,
            legacyCount: legacyFileIds.size,
            tableCount: tableFileIds.size,
            missingInTableCount: missingInTable.length,
            extraInTableCount: extraInTable.length,
            missingInTableSample: missingInTable.slice(
                0,
                SHADOW_DIFF_SAMPLE_LIMIT,
            ),
            extraInTableSample: extraInTable.slice(0, SHADOW_DIFF_SAMPLE_LIMIT),
        };
        if (missingInTable.length > 0 || extraInTable.length > 0) {
            console.error("[file-reference-shadow] mismatch", payload);
        } else {
            console.info("[file-reference-shadow] matched", payload);
        }
        return {
            legacyCount: legacyFileIds.size,
            tableCount: tableFileIds.size,
            missingInTable,
            extraInTable,
        };
    });
}
