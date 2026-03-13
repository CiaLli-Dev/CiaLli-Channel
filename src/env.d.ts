/// <reference types="astro/client" />

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../.astro/types.d.ts" />

declare namespace App {
    interface Locals {
        sidebarProfile?: import("./types/app").SidebarProfileData;
        siteSettings?: import("./types/site-settings").ResolvedSiteSettings;
        requestId?: string;
        csrfToken?: string;
    }
}

interface ImportMetaEnv {
    readonly UMAMI_API_KEY?: string;
    readonly DIRECTUS_URL?: string;
    readonly DIRECTUS_STATIC_TOKEN?: string;
    readonly BANGUMI_TOKEN_ENCRYPTION_KEY?: string;
    readonly KV_REST_API_URL?: string;
    readonly KV_REST_API_TOKEN?: string;
    readonly DIRECTUS_EXPORT_INCLUDE_DRAFTS?: string;
    readonly DIRECTUS_EXPORT_CLEAN?: string;
    readonly DIRECTUS_POSTS_COLLECTION?: string;
    readonly DIRECTUS_SPEC_COLLECTION?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
