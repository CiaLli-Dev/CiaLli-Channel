import type { JsonObject } from "@/types/json";
import type { AiRuntimeSettings } from "@/types/site-settings";
import { defaultSiteSettings } from "@/config";
import { createOne, readMany, updateOne } from "@/server/directus/client";
import {
    decryptSecretValue,
    encryptSecretValue,
} from "@/server/crypto/secret-box";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";

export type PublicAiSettings = {
    enabled: boolean;
    articleSummaryEnabled: boolean;
    baseUrl: string;
    model: string;
    apiKeyConfigured?: boolean;
    updatedAt?: string | null;
};

export type DecryptedAiSettings = PublicAiSettings & {
    apiKey: string | null;
};

export type AiSettingsPatch = {
    enabled?: boolean;
    articleSummaryEnabled?: boolean;
    baseUrl?: string | null;
    model?: string | null;
    apiKey?: string | null;
    clearApiKey?: boolean;
};

type SiteSettingsRow = {
    id: string;
    settings_other?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAiSection(source: unknown): unknown {
    if (!isRecord(source)) {
        return null;
    }
    return source.ai;
}

export function resolveStoredAiSettings(raw: unknown): AiRuntimeSettings {
    const source = isRecord(raw) ? raw : {};
    const base = defaultSiteSettings.ai;
    return {
        enabled: Boolean(source.enabled ?? base.enabled),
        articleSummaryEnabled: Boolean(
            source.articleSummaryEnabled ?? base.articleSummaryEnabled,
        ),
        baseUrl: String(source.baseUrl || "").trim(),
        model: String(source.model || "").trim(),
        apiKeyEncrypted:
            typeof source.apiKeyEncrypted === "string" &&
            source.apiKeyEncrypted.trim()
                ? source.apiKeyEncrypted.trim()
                : null,
        updatedAt:
            typeof source.updatedAt === "string" && source.updatedAt.trim()
                ? source.updatedAt.trim()
                : null,
    };
}

export function buildPublicAiSettings(
    stored: AiRuntimeSettings,
): PublicAiSettings {
    return {
        enabled: stored.enabled,
        articleSummaryEnabled: stored.articleSummaryEnabled,
        baseUrl: stored.baseUrl,
        model: stored.model,
        apiKeyConfigured: Boolean(stored.apiKeyEncrypted),
        updatedAt: stored.updatedAt,
    };
}

export function decryptAiSettings(
    stored: AiRuntimeSettings,
): DecryptedAiSettings {
    return {
        ...buildPublicAiSettings(stored),
        apiKey: decryptSecretValue(stored.apiKeyEncrypted),
    };
}

export function serializeAiSettingsPatch(
    patch: AiSettingsPatch,
    current: AiRuntimeSettings,
): AiRuntimeSettings {
    const clearApiKey = patch.clearApiKey === true || patch.apiKey === null;
    const nextKey =
        clearApiKey || patch.apiKey === null
            ? null
            : typeof patch.apiKey === "string" && patch.apiKey.trim()
              ? encryptSecretValue(patch.apiKey)
              : current.apiKeyEncrypted;

    return {
        enabled:
            patch.enabled === undefined
                ? current.enabled
                : Boolean(patch.enabled),
        articleSummaryEnabled:
            patch.articleSummaryEnabled === undefined
                ? current.articleSummaryEnabled
                : Boolean(patch.articleSummaryEnabled),
        baseUrl:
            patch.baseUrl === undefined
                ? current.baseUrl
                : String(patch.baseUrl || "").trim(),
        model:
            patch.model === undefined
                ? current.model
                : String(patch.model || "").trim(),
        apiKeyEncrypted: nextKey,
        updatedAt: new Date().toISOString(),
    };
}

async function readSiteSettingsRow(): Promise<SiteSettingsRow | null> {
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_site_settings", {
                filter: { key: { _eq: "default" } } as JsonObject,
                limit: 1,
                sort: ["-date_updated", "-date_created"],
                fields: ["id", "settings_other"],
            }),
    );
    const row = rows[0];
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        settings_other: row.settings_other,
    };
}

export async function loadStoredAiSettings(): Promise<AiRuntimeSettings> {
    const row = await readSiteSettingsRow();
    return resolveStoredAiSettings(readAiSection(row?.settings_other));
}

export async function loadDecryptedAiSettings(): Promise<DecryptedAiSettings> {
    return decryptAiSettings(await loadStoredAiSettings());
}

export async function saveAiSettingsPatch(
    patch: AiSettingsPatch,
): Promise<PublicAiSettings> {
    return await withServiceRepositoryContext(async () => {
        const row = await readSiteSettingsRow();
        const settingsOther = isRecord(row?.settings_other)
            ? row.settings_other
            : {};
        const current = resolveStoredAiSettings(settingsOther.ai);
        const next = serializeAiSettingsPatch(patch, current);
        const nextSettingsOther = {
            musicPlayer: defaultSiteSettings.musicPlayer,
            ...settingsOther,
            ai: next,
        };

        if (!row) {
            await createOne("app_site_settings", {
                key: "default",
                status: "published",
                settings_other: nextSettingsOther,
            });
        } else {
            await updateOne("app_site_settings", row.id, {
                settings_other: nextSettingsOther,
            });
        }

        return buildPublicAiSettings(next);
    });
}
