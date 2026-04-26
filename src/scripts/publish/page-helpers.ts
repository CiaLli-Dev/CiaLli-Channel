/**
 * publish-page.ts 的辅助函数 — 纯工具函数与加密逻辑
 *
 * 不依赖 DOM、不依赖运行时状态，可独立测试。
 */

import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/shared/i18n-runtime";

// ── 类型 ──

export type PendingUpload = {
    file: File;
    localUrl: string; // URL.createObjectURL()
    purpose: "cover" | "inline";
    fileName: string; // "{shortId}-cover.jpg" or "{shortId}-1.jpg"
};

export type ToolbarAction =
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "quote"
    | "inline-code"
    | "code-block";

export type PublishRuntimeWindow = Window &
    typeof globalThis & {
        renderMermaidDiagrams?: () => Promise<void>;
    };

export type ProtectedPayloadV2 = {
    v: 2;
    alg: "AES-GCM";
    kdf: "PBKDF2";
    hash: "SHA-256";
    it: number;
    s: string;
    iv: string;
    ct: string;
};

export type ProtectedArticlePlaintext = {
    format: "article-md-v1";
    markdown: string;
    html: string;
};

// ── 常量 ──

export const TOOLBAR_ACTIONS: ReadonlySet<ToolbarAction> = new Set([
    "bold",
    "italic",
    "underline",
    "strike",
    "quote",
    "inline-code",
    "code-block",
]);

export const COVER_OUTPUT_WIDTH = 960;
export const COVER_OUTPUT_HEIGHT = 576;

export const PROTECTED_VERSION_PREFIX = "CL2:";
export const PROTECTED_MARKER = "CIALLI-VERIFY:";
export const PROTECTED_PBKDF2_ITERATIONS = 210_000;
export const PROTECTED_SALT_BYTES = 16;
export const PROTECTED_IV_BYTES = 12;

// ── 通用工具函数 ──

export function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function toStringValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    return "";
}

export function toNullableString(value: unknown): string | null {
    const normalized = toStringValue(value);
    return normalized || null;
}

export function toBooleanValue(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    return fallback;
}

export function toStringArrayValue(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => toStringValue(entry))
            .filter((entry) => Boolean(entry));
    }
    if (typeof value === "string") {
        return value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return [];
}

export function csvToArray(raw: string): string[] {
    return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export function arrayToCsv(values: string[]): string {
    return values.join(", ");
}

export function getApiMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    const error = data?.error as Record<string, unknown> | undefined;
    const fallbackMessage =
        toStringValue(fallback) || t(I18nKey.articleEditorSaveFailedRetry);
    const message = toStringValue(error?.message);
    if (!message) {
        return fallbackMessage;
    }
    if (toStringValue(error?.code) === "VALIDATION_ERROR") {
        const hasTitleError = /\btitle\s*:/.test(message);
        const hasBodyError = /\bbody_markdown\s*:/.test(message);
        if (hasTitleError && hasBodyError) {
            return t(I18nKey.articleEditorTitleBodyRequired);
        }
        if (hasTitleError) {
            return t(I18nKey.articleEditorTitleRequired);
        }
        if (hasBodyError) {
            return t(I18nKey.articleEditorBodyRequired);
        }
    }
    return message;
}

export function extractUploadFileId(
    data: Record<string, unknown> | null,
): string {
    const file = toRecord(data?.file);
    const idFromFile = toStringValue(file?.id);
    if (idFromFile) {
        return idFromFile;
    }
    return toStringValue(data?.id);
}

export function buildDirectusAssetPreview(fileId: string): string {
    const normalized = String(fileId || "").trim();
    if (!normalized) {
        return "";
    }
    return `/api/v1/assets/${encodeURIComponent(normalized)}?width=960&height=540&fit=cover`;
}

export function getImageFileExt(file: File): string {
    const mimeMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/avif": "avif",
    };
    return mimeMap[file.type] || "jpg";
}

export function isProtectedContentBody(value: string): boolean {
    return String(value || "")
        .trim()
        .startsWith(PROTECTED_VERSION_PREFIX);
}

export function trimToWeightedMax(
    value: string,
    max: number,
    charWeight: (ch: string) => number,
): string {
    let total = 0;
    let result = "";
    for (const ch of value) {
        const nextWeight = charWeight(ch);
        if (total + nextWeight > max) {
            break;
        }
        result += ch;
        total += nextWeight;
    }
    return result;
}

// ── Base64URL 工具 ──

export function toBase64Url(value: Uint8Array | string): string {
    const sourceBytes =
        typeof value === "string" ? new TextEncoder().encode(value) : value;
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < sourceBytes.length; i += chunkSize) {
        binary += String.fromCharCode(
            ...sourceBytes.subarray(i, i + chunkSize),
        );
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

export function fromBase64Url(input: string): Uint8Array {
    const normalized = String(input || "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padLength =
        normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    const padded = normalized + "=".repeat(padLength);
    const binary = atob(padded);
    const outputBuffer = new ArrayBuffer(binary.length);
    const output = new Uint8Array(outputBuffer);
    for (let i = 0; i < binary.length; i += 1) {
        output[i] = binary.charCodeAt(i);
    }
    return output;
}

export function toStrictArrayBuffer(input: Uint8Array): ArrayBuffer {
    const { buffer, byteOffset, byteLength } = input;
    return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

// ── 加密工具 ──

export function createProtectedArticlePlaintext(
    markdown: string,
    html: string,
): string {
    return JSON.stringify({
        format: "article-md-v1",
        markdown,
        html,
    });
}

export function resolveProtectedArticleMarkdown(
    raw: string,
): ProtectedArticlePlaintext {
    const parsed = JSON.parse(String(raw || ""));
    if (
        !parsed ||
        typeof parsed !== "object" ||
        parsed.format !== "article-md-v1" ||
        typeof parsed.markdown !== "string" ||
        typeof parsed.html !== "string"
    ) {
        throw new Error("INVALID_PROTECTED_CONTENT");
    }
    return parsed as ProtectedArticlePlaintext;
}

export function isWrongProtectedPasswordError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "OperationError") {
        return true;
    }
    if (!(error instanceof Error)) {
        return false;
    }
    return error.message === "PASSWORD_INVALID";
}

export async function deriveProtectedAesKey(
    password: string,
    salt: Uint8Array,
): Promise<CryptoKey> {
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"],
    );
    return await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: toStrictArrayBuffer(salt),
            iterations: PROTECTED_PBKDF2_ITERATIONS,
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"],
    );
}

export async function encryptArticleBody(
    markdown: string,
    html: string,
    password: string,
): Promise<string> {
    if (!window.crypto?.subtle) {
        throw new Error(t(I18nKey.articleEditorEncryptUnsupported));
    }
    const cleanPassword = String(password || "").trim();
    if (!cleanPassword) {
        throw new Error(t(I18nKey.articleEditorPasswordRequired));
    }

    const plaintext = `${PROTECTED_MARKER}${createProtectedArticlePlaintext(markdown, html)}`;
    const salt = window.crypto.getRandomValues(
        new Uint8Array(PROTECTED_SALT_BYTES),
    );
    const iv = window.crypto.getRandomValues(
        new Uint8Array(PROTECTED_IV_BYTES),
    );
    const key = await deriveProtectedAesKey(cleanPassword, salt);
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: toStrictArrayBuffer(iv) },
        key,
        new TextEncoder().encode(plaintext),
    );
    const payload: ProtectedPayloadV2 = {
        v: 2,
        alg: "AES-GCM",
        kdf: "PBKDF2",
        hash: "SHA-256",
        it: PROTECTED_PBKDF2_ITERATIONS,
        s: toBase64Url(salt),
        iv: toBase64Url(iv),
        ct: toBase64Url(new Uint8Array(encrypted)),
    };

    return `${PROTECTED_VERSION_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}

export async function decryptArticleBodyWithPassword(
    encryptedBody: string,
    password: string,
): Promise<string> {
    if (!window.crypto?.subtle) {
        throw new Error(t(I18nKey.articleEditorDecryptUnsupported));
    }
    if (!isProtectedContentBody(encryptedBody)) {
        throw new Error("UNSUPPORTED_FORMAT");
    }
    const cleanPassword = String(password || "").trim();
    if (!cleanPassword) {
        throw new Error("PASSWORD_REQUIRED");
    }

    const encodedPayload = String(encryptedBody).slice(
        PROTECTED_VERSION_PREFIX.length,
    );
    const payloadJson = new TextDecoder().decode(fromBase64Url(encodedPayload));
    const payload = JSON.parse(payloadJson) as Partial<ProtectedPayloadV2>;
    if (
        payload.v !== 2 ||
        payload.kdf !== "PBKDF2" ||
        payload.alg !== "AES-GCM" ||
        typeof payload.it !== "number" ||
        !payload.s ||
        !payload.iv ||
        !payload.ct
    ) {
        throw new Error("INVALID_PAYLOAD");
    }

    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(cleanPassword),
        { name: "PBKDF2" },
        false,
        ["deriveKey"],
    );
    const key = await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: toStrictArrayBuffer(fromBase64Url(payload.s)),
            iterations: payload.it,
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
    );
    const decrypted = await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: toStrictArrayBuffer(fromBase64Url(payload.iv)),
        },
        key,
        toStrictArrayBuffer(fromBase64Url(payload.ct)),
    );
    const plaintext = new TextDecoder().decode(decrypted);
    if (!plaintext.startsWith(PROTECTED_MARKER)) {
        throw new Error("PASSWORD_INVALID");
    }
    return plaintext.slice(PROTECTED_MARKER.length);
}

// ── Markdown 运行时刷新 ──

import { setupCodeCopyDelegation } from "@/scripts/markdown/code-copy";
import { refreshGithubCards } from "@/scripts/markdown/github-card-runtime";

export async function refreshMarkdownRuntime(
    runtimeWindow: PublishRuntimeWindow,
): Promise<void> {
    setupCodeCopyDelegation();
    try {
        await refreshGithubCards();
    } catch (error) {
        console.warn("[publish] refresh github cards failed:", error);
    }
    if (typeof runtimeWindow.renderMermaidDiagrams === "function") {
        try {
            await runtimeWindow.renderMermaidDiagrams();
        } catch (error) {
            console.warn("[publish] refresh mermaid failed:", error);
        }
    }
}

// ── 暂存上传管理 ──

export function clearPendingUploads(
    pendingUploads: Map<string, PendingUpload>,
): void {
    for (const pending of pendingUploads.values()) {
        URL.revokeObjectURL(pending.localUrl);
    }
    pendingUploads.clear();
}

export function removePendingCover(
    pendingUploads: Map<string, PendingUpload>,
): void {
    for (const [key, pending] of pendingUploads.entries()) {
        if (pending.purpose === "cover") {
            URL.revokeObjectURL(pending.localUrl);
            pendingUploads.delete(key);
        }
    }
}

// ── 工具栏操作（委托给 publish-page-toolbar）──

export { applyToolbarAction } from "@/scripts/publish/page-toolbar";
