/**
 * Upload purpose identifiers — sent as `purpose` field in upload FormData.
 * Server uses this to enforce per-purpose file size limits.
 */
export type UploadPurpose =
    | "avatar"
    | "registration-avatar"
    | "favicon"
    | "banner"
    | "diary-image"
    | "album-photo"
    | "article-cover"
    | "general";

/** Maximum file size in bytes per upload purpose. */
export const UPLOAD_LIMITS: Record<UploadPurpose, number> = {
    avatar: 1.5 * 1024 * 1024, // 1.5 MB
    "registration-avatar": 1.5 * 1024 * 1024, // 1.5 MB
    favicon: 500 * 1024, // 500 KB
    banner: 2 * 1024 * 1024, // 2 MB
    "diary-image": 5 * 1024 * 1024, // 5 MB
    "album-photo": 15 * 1024 * 1024, // 15 MB
    "article-cover": 5 * 1024 * 1024, // 5 MB
    general: 10 * 1024 * 1024, // 10 MB fallback
};

/** Human-readable size label per purpose (for error messages). */
export const UPLOAD_LIMIT_LABELS: Record<UploadPurpose, string> = {
    avatar: "1.5 MB",
    "registration-avatar": "1.5 MB",
    favicon: "500 KB",
    banner: "2 MB",
    "diary-image": "5 MB",
    "album-photo": "15 MB",
    "article-cover": "5 MB",
    general: "10 MB",
};
