/**
 * 注册页面辅助函数 — 类型定义、工具函数、错误解析、草稿持久化
 *
 * 不依赖 DOM 运行时状态，可独立测试。
 */

// ── 类型 ──

export type ProgressTaskHandle = number;
export type ProgressTaskPayload = Record<string, unknown>;
export type ProgressTaskStartPayload = ProgressTaskPayload & {
    delayMs?: number;
};

export type RegisterPageMessageTone = "normal" | "error" | "success";
export type FieldHintTone = "default" | "error" | "success" | "loading";

export type RegisterErrorPayload = {
    error?: {
        code?: string;
        message?: string;
    };
};

export type ReapplyDraftPayload = {
    email: string;
    username: string;
    displayName: string;
    reason: string;
    avatarFileId: string;
    avatarUrl: string;
};

export type ReapplyDraftInput =
    | {
          email?: string | null;
          username?: string | null;
          displayName?: string | null;
          reason?: string | null;
          avatarFileId?: string | null;
          avatarUrl?: string | null;
      }
    | null
    | undefined;

// ── 错误码映射 ──

const ERROR_CODE_MAP: Record<string, keyof RegisterI18n> = {
    REGISTER_DISABLED: "registerDisabled",
    EMAIL_EXISTS: "emailExists",
    USERNAME_EXISTS: "usernameExists",
    REGISTRATION_REQUEST_EXISTS: "requestExists",
    REGISTRATION_STATUS_CONFLICT: "statusConflict",
    REGISTRATION_REQUEST_FORBIDDEN: "requestForbidden",
    REGISTRATION_PASSWORD_REQUIRED: "passwordRequired",
    REGISTRATION_PASSWORD_INVALID: "passwordInvalid",
    REGISTRATION_PASSWORD_TOO_SHORT: "passwordTooShort",
    REGISTRATION_PASSWORD_TOO_LONG: "passwordTooLong",
};

export type RegisterI18n = {
    registerDisabled: string;
    emailExists: string;
    usernameExists: string;
    requestExists: string;
    statusConflict: string;
    requestForbidden: string;
    passwordRequired: string;
    passwordInvalid: string;
    passwordTooShort: string;
    passwordTooLong: string;
    submitFailed: string;
    [key: string]: string;
};

export function resolveRegisterError(
    data: RegisterErrorPayload | null,
    i18n: RegisterI18n,
): string {
    const error = data?.error;
    const code = String(error?.code || "");
    const key = ERROR_CODE_MAP[code];
    if (key) {
        return i18n[key];
    }
    return String(error?.message || i18n.submitFailed);
}

// ── 草稿存储 ──

export const REAPPLY_DRAFT_STORAGE_KEY = "dc_registration_reapply_draft_v1";

export function persistReapplyDraft(
    draft: ReapplyDraftInput,
    storageKey: string,
): void {
    try {
        const payload: ReapplyDraftPayload = {
            email: String(draft?.email || "").trim(),
            username: String(draft?.username || "").trim(),
            displayName: String(draft?.displayName || "").trim(),
            reason: String(draft?.reason || "").trim(),
            avatarFileId: String(draft?.avatarFileId || "").trim(),
            avatarUrl: String(draft?.avatarUrl || "").trim(),
        };
        if (hasDraftContent(payload)) {
            window.sessionStorage.setItem(storageKey, JSON.stringify(payload));
        }
    } catch {
        // ignore
    }
}

function hasDraftContent(payload: ReapplyDraftPayload): boolean {
    return Boolean(
        payload.email ||
        payload.username ||
        payload.displayName ||
        payload.reason ||
        payload.avatarFileId,
    );
}

export function consumeReapplyDraft(
    storageKey: string,
): ReapplyDraftPayload | null {
    try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) {
            return null;
        }
        window.sessionStorage.removeItem(storageKey);
        const data: unknown = JSON.parse(raw);
        if (!data || typeof data !== "object") {
            return null;
        }
        const d = data as Record<string, unknown>;
        return {
            email: String(d["email"] || "").trim(),
            username: String(d["username"] || "").trim(),
            displayName: String(d["displayName"] || "").trim(),
            reason: String(d["reason"] || "").trim(),
            avatarFileId: String(d["avatarFileId"] || "").trim(),
            avatarUrl: String(d["avatarUrl"] || "").trim(),
        };
    } catch {
        return null;
    }
}

// ── DOM 工具 ──

export function setPageMessage(
    message: string,
    tone: RegisterPageMessageTone = "normal",
): void {
    const messageEl = document.getElementById("register-message");
    if (!messageEl) {
        return;
    }
    if (!message) {
        messageEl.classList.add("hidden");
        messageEl.textContent = "";
        messageEl.classList.remove("text-red-500", "text-emerald-600");
        messageEl.classList.add("text-70");
        return;
    }
    messageEl.classList.remove("hidden", "text-red-500", "text-emerald-600");
    messageEl.classList.add(
        tone === "error" ? "text-red-500" : "text-emerald-600",
    );
    messageEl.textContent = message;
}

export function setFieldHint(
    element: Element | null,
    message: string,
    tone: FieldHintTone = "default",
): void {
    if (!element) {
        return;
    }
    const text = String(message || "").trim();
    element.classList.remove(
        "hidden",
        "text-60",
        "text-red-500",
        "text-emerald-600",
        "text-(--primary)",
    );
    if (!text) {
        element.textContent = "";
        element.classList.add("hidden");
        return;
    }
    element.textContent = text;
    if (tone === "error") {
        element.classList.add("text-red-500");
        return;
    }
    if (tone === "success") {
        element.classList.add("text-emerald-600");
        return;
    }
    if (tone === "loading") {
        element.classList.add("text-(--primary)");
        return;
    }
    element.classList.add("text-60");
}

export function getCsrfToken(): string {
    const element = document.querySelector('meta[name="cialli-csrf-token"]');
    if (!(element instanceof HTMLMetaElement)) {
        return "";
    }
    return element.content || "";
}

export function buildAssetUrl(fileId: string): string {
    const normalized = String(fileId || "").trim();
    if (!normalized) {
        return "";
    }
    return `/api/v1/public/assets/${encodeURIComponent(normalized)}?width=160&height=160&fit=cover`;
}

export function toSafeFileLabel(value: string): string {
    return String(value || "")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ");
}

// ── 状态页类型 ──

export type StatusPageDialogs = {
    showNoticeDialog: (opts: { message: string }) => Promise<void>;
    showConfirmDialog: (opts: {
        message: string;
        confirmText?: string;
        cancelText?: string;
        confirmVariant?: string;
    }) => Promise<boolean>;
};

const API_STATUS_SESSION = "/api/v1/public/registration-session";
const API_STATUS_BASE = "/api/v1/public/registration-requests";

// ── 状态页：删除会话 ──

export async function deleteRegistrationSession(
    i18n: Record<string, string>,
): Promise<void> {
    const response = await fetch(API_STATUS_SESSION, {
        method: "DELETE",
        credentials: "include",
        headers: {
            Accept: "application/json",
            "x-csrf-token": getCsrfToken(),
        },
    });
    const data = (await response.json().catch(() => null)) as
        | (RegisterErrorPayload & { ok?: boolean })
        | null;
    if (!response.ok || !data?.ok) {
        throw new Error(
            resolveRegisterError(
                data,
                i18n as Parameters<typeof resolveRegisterError>[1],
            ),
        );
    }
}

// ── 状态页：取消申请 ──

export async function sendCancelRequest(
    requestId: string,
    i18n: Record<string, string>,
): Promise<void> {
    const response = await fetch(
        `${API_STATUS_BASE}/${encodeURIComponent(requestId)}`,
        {
            method: "PATCH",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "x-csrf-token": getCsrfToken(),
            },
            body: JSON.stringify({ action: "cancel" }),
        },
    );
    const data = (await response.json().catch(() => null)) as
        | (RegisterErrorPayload & { ok?: boolean })
        | null;
    if (!response.ok || !data?.ok) {
        throw new Error(
            resolveRegisterError(
                data,
                i18n as Parameters<typeof resolveRegisterError>[1],
            ),
        );
    }
}

// ── 状态页：重新申请点击处理 ──

export async function handleReapplyClick(
    retryButton: HTMLElement,
    originalText: string,
    i18n: Record<string, string>,
): Promise<void> {
    persistReapplyDraft(
        {
            email: retryButton.getAttribute("data-reapply-email"),
            username: retryButton.getAttribute("data-reapply-username"),
            displayName: retryButton.getAttribute("data-reapply-display-name"),
            reason: retryButton.getAttribute("data-reapply-reason"),
            avatarFileId: retryButton.getAttribute("data-reapply-avatar-file"),
            avatarUrl: retryButton.getAttribute("data-reapply-avatar-url"),
        },
        REAPPLY_DRAFT_STORAGE_KEY,
    );
    retryButton.setAttribute("disabled", "true");
    retryButton.textContent = i18n["processing"] ?? "";
    const overlayHandle = startOverlayTask({
        title: i18n["resetStatusTitle"] ?? "",
        mode: "indeterminate",
        text: i18n["processing"] ?? "",
    });
    try {
        await deleteRegistrationSession(i18n);
        updateOverlayTask(overlayHandle, {
            text: i18n["processedRedirecting"] ?? "",
        });
        window.location.assign("/auth/register");
    } catch (error) {
        window.alert(
            error instanceof Error
                ? error.message
                : (i18n["resetFailed"] ?? ""),
        );
    } finally {
        retryButton.removeAttribute("disabled");
        retryButton.textContent = originalText;
        finishOverlayTask(overlayHandle);
    }
}

// ── 状态页：取消申请点击处理 ──

export async function handleCancelClick(
    cancelButton: HTMLElement,
    originalText: string,
    i18n: Record<string, string>,
    dialogs: StatusPageDialogs,
): Promise<void> {
    const requestId = String(
        cancelButton.getAttribute("data-request-id") || "",
    ).trim();
    if (!requestId) {
        await dialogs.showNoticeDialog({
            message: i18n["invalidRequestId"] ?? "",
        });
        return;
    }
    const confirmCancel = await dialogs.showConfirmDialog({
        message: i18n["confirmCancelRequest"] ?? "",
        confirmText: i18n["confirmCancelText"] ?? "",
        cancelText: i18n["cancelThinkAgain"] ?? "",
        confirmVariant: "danger",
    });
    if (!confirmCancel) {
        return;
    }
    cancelButton.setAttribute("disabled", "true");
    cancelButton.textContent = i18n["processing"] ?? "";
    const overlayHandle = startOverlayTask({
        title: i18n["cancelOverlayTitle"] ?? "",
        mode: "indeterminate",
        text: i18n["processing"] ?? "",
    });
    try {
        await sendCancelRequest(requestId, i18n);
        updateOverlayTask(overlayHandle, {
            text: i18n["cancelSuccessRefreshing"] ?? "",
        });
        window.location.assign("/auth/register");
    } catch (error) {
        await dialogs.showNoticeDialog({
            message:
                error instanceof Error
                    ? error.message
                    : (i18n["cancelFailed"] ?? ""),
        });
    } finally {
        cancelButton.removeAttribute("disabled");
        cancelButton.textContent = originalText;
        finishOverlayTask(overlayHandle);
    }
}

// ── 状态页初始化 ──

export function initRegistrationStatusPage(
    i18n: Record<string, string>,
    dialogs: StatusPageDialogs,
): void {
    const retryButton = document.getElementById("register-reapply-btn");
    if (retryButton && !retryButton.hasAttribute("data-bound")) {
        retryButton.setAttribute("data-bound", "1");
        const originalText =
            retryButton.textContent || i18n["reapplyButtonText"] || "";
        retryButton.addEventListener("click", () => {
            void handleReapplyClick(retryButton, originalText, i18n);
        });
    }

    const cancelButton = document.getElementById("register-cancel-btn");
    if (cancelButton && !cancelButton.hasAttribute("data-bound")) {
        cancelButton.setAttribute("data-bound", "1");
        const originalText =
            cancelButton.textContent || i18n["cancelRequestButtonText"] || "";
        cancelButton.addEventListener("click", () => {
            void handleCancelClick(cancelButton, originalText, i18n, dialogs);
        });
    }
}

// ── 注册页进度层类型 ──

export type CialliProgressOverlay = {
    startTask: (opts: ProgressTaskStartPayload) => ProgressTaskHandle;
    updateTask: (
        handle: ProgressTaskHandle,
        stage: ProgressTaskPayload,
    ) => void;
    finishTask: (handle: ProgressTaskHandle) => void;
};

export type CialliWindow = Window &
    typeof globalThis & {
        __CIALLI_PROGRESS_OVERLAY__?: CialliProgressOverlay;
        showNoticeDialog: (opts: { message: string }) => Promise<void>;
        showConfirmDialog: (opts: {
            message: string;
            confirmText?: string;
            cancelText?: string;
            confirmVariant?: string;
        }) => Promise<boolean>;
    };

export function getProgressOverlay(): CialliProgressOverlay | undefined {
    return (window as CialliWindow).__CIALLI_PROGRESS_OVERLAY__;
}

export function startOverlayTask(
    options: ProgressTaskStartPayload,
): ProgressTaskHandle | null {
    const progressOverlay = getProgressOverlay();
    if (!progressOverlay) return null;
    return progressOverlay.startTask({ delayMs: 300, ...options });
}

export function updateOverlayTask(
    handle: ProgressTaskHandle | null,
    stage: ProgressTaskPayload,
): void {
    const progressOverlay = getProgressOverlay();
    if (!progressOverlay || typeof handle !== "number") return;
    progressOverlay.updateTask(handle, stage);
}

export function finishOverlayTask(handle: ProgressTaskHandle | null): void {
    const progressOverlay = getProgressOverlay();
    if (!progressOverlay || typeof handle !== "number") return;
    progressOverlay.finishTask(handle);
}
