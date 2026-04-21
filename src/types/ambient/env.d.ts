/// <reference types="astro/client" />

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../.astro/types.d.ts" />

declare namespace App {
    interface Locals {
        sidebarProfile?: import("../app").SidebarProfileData;
        siteSettings?: import("../site-settings").ResolvedSiteSettings;
        requestId?: string;
        csrfToken?: string;
        requestLanguage?: string;
    }
}

interface ImportMetaEnv {
    readonly DIRECTUS_URL?: string;
    readonly DIRECTUS_PUBLIC_URL?: string;
    readonly DIRECTUS_STATIC_TOKEN?: string;
    readonly PUBLIC_ASSET_BASE_URL?: string;
    readonly APP_PUBLIC_BASE_URL?: string;
    readonly BANGUMI_TOKEN_ENCRYPTION_KEY?: string;
    readonly AI_SUMMARY_INTERNAL_SECRET?: string;
    readonly AI_SUMMARY_DIRECTUS_TOKEN?: string;
    readonly AI_SUMMARY_WORKER_PORT?: string;
    readonly AI_SUMMARY_JOB_LEASE_SECONDS?: string;
    readonly AI_SUMMARY_MAX_CONCURRENCY?: string;
    readonly AI_SUMMARY_JOB_BATCH_SIZE?: string;
    readonly REDIS_URL?: string;
    readonly REDIS_NAMESPACE?: string;
    readonly STORAGE_LOCATIONS?: string;
    readonly STORAGE_S3_DRIVER?: string;
    readonly STORAGE_S3_KEY?: string;
    readonly STORAGE_S3_SECRET?: string;
    readonly STORAGE_S3_BUCKET?: string;
    readonly STORAGE_S3_REGION?: string;
    readonly STORAGE_S3_ENDPOINT?: string;
    readonly STORAGE_S3_FORCE_PATH_STYLE?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
