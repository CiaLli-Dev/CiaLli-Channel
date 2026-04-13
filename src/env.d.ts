/// <reference types="astro/client" />

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../.astro/types.d.ts" />

declare namespace App {
    interface Locals {
        sidebarProfile?: import("./types/app").SidebarProfileData;
        siteSettings?: import("./types/site-settings").ResolvedSiteSettings;
        requestId?: string;
        csrfToken?: string;
        requestLanguage?: string;
    }
}

interface ImportMetaEnv {
    readonly DIRECTUS_URL?: string;
    readonly DIRECTUS_STATIC_TOKEN?: string;
    readonly BANGUMI_TOKEN_ENCRYPTION_KEY?: string;
    readonly REDIS_NAMESPACE?: string;
    readonly KV_REST_API_URL?: string;
    readonly KV_REST_API_TOKEN?: string;
    readonly VERCEL_ENV?: string;
    readonly VERCEL_GIT_COMMIT_REF?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
