/**
 * 注册页面主逻辑
 *
 * 负责页面初始化、表单提交、状态页操作。
 * 验证器见 register-form-validators.ts，头像裁剪见 register-avatar-crop.ts。
 */

import { setupPageInit } from "@/utils/page-init";
import {
    type ProgressTaskHandle,
    type RegisterErrorPayload,
    type CialliWindow,
    type StatusPageDialogs,
    REAPPLY_DRAFT_STORAGE_KEY,
    resolveRegisterError,
    consumeReapplyDraft,
    setPageMessage,
    getCsrfToken,
    buildAssetUrl,
    startOverlayTask,
    updateOverlayTask,
    finishOverlayTask,
    initRegistrationStatusPage,
} from "@/scripts/auth/page-helpers";
import {
    type FieldValidators,
    type FormElements,
    createFieldValidators,
} from "@/scripts/auth/form-validators";
import {
    type AvatarCropElements,
    type AvatarCropContext,
    buildCropSetupResult,
} from "@/scripts/auth/avatar-crop";

// ── 运行时全局状态 ──

let defaultAvatarPreviewSrc = "";
let registerI18n: Record<string, string> = {};

const API_REGISTER = "/api/v1/public/registration-requests";
const DATA_BOUND = "data-register-bound";

let DEFAULT_AVATAR_SRC = "";

// ── 页面配置读取 ──

function readPageConfig(): void {
    const el = document.getElementById("register-page-config");
    if (el) {
        defaultAvatarPreviewSrc =
            el.getAttribute("data-default-avatar-src") ?? "";
        registerI18n = JSON.parse(
            el.getAttribute("data-register-i18n") ?? "{}",
        ) as Record<string, string>;
    }
}

// ── 当前头像图片降级处理 ──

function bindCurrentAvatarFallback(): void {
    const currentAvatarEl = document.getElementById("register-current-avatar");
    if (!(currentAvatarEl instanceof HTMLImageElement)) {
        return;
    }
    currentAvatarEl.addEventListener(
        "error",
        () => {
            currentAvatarEl.src = DEFAULT_AVATAR_SRC;
        },
        { once: true },
    );
}

// ── 提交处理辅助 ──

type SubmitHandlerOptions = {
    form: HTMLElement;
    emailEl: HTMLInputElement;
    usernameEl: HTMLInputElement;
    displayNameEl: HTMLInputElement;
    passwordEl: HTMLInputElement;
    reasonEl: HTMLTextAreaElement;
    submitBtn: HTMLButtonElement;
    submitText: HTMLElement;
    avatarPreviewEl: HTMLImageElement;
    validators: FieldValidators;
    passwordCheckPassedRef: { value: boolean };
    ctx: AvatarCropContext;
    uploadCroppedAvatar: (blob: Blob) => Promise<string>;
};

function collectFormValues(opts: SubmitHandlerOptions): {
    email: string;
    username: string;
    displayName: string;
    password: string;
    registrationReason: string;
} {
    return {
        email: String(opts.emailEl.value || "").trim(),
        username: String(opts.usernameEl.value || "").trim(),
        displayName: String(opts.displayNameEl.value || "").trim(),
        password: String(opts.passwordEl.value || ""),
        registrationReason: String(opts.reasonEl.value || "").trim(),
    };
}

function validateFormBasic(
    values: ReturnType<typeof collectFormValues>,
    passwordCheckPassedRef: { value: boolean },
    validators: FieldValidators,
): string | null {
    const { email, username, displayName, password, registrationReason } =
        values;
    if (
        !email ||
        !username ||
        !displayName ||
        !password ||
        !registrationReason
    ) {
        return registerI18n["completeForm"] ?? "";
    }
    if (password.length < 8 || password.length > 20) {
        return registerI18n["passwordRangeInvalid"] ?? "";
    }
    const passwordAvailable = passwordCheckPassedRef.value
        ? true
        : validators.validatePasswordField(true);
    if (!passwordAvailable) {
        return registerI18n["fixPasswordFirst"] ?? "";
    }
    return null;
}

async function uploadPendingAvatarIfNeeded(
    opts: SubmitHandlerOptions,
    overlayHandle: ProgressTaskHandle | null,
): Promise<void> {
    const { ctx, avatarPreviewEl, submitText, uploadCroppedAvatar } = opts;
    if (!ctx.pendingAvatarBlob) {
        return;
    }
    submitText.textContent = registerI18n["uploadAvatarButtonText"] ?? "";
    updateOverlayTask(overlayHandle, {
        text: registerI18n["uploadAvatarOverlayText"] ?? "",
    });
    ctx.avatarFileId = await uploadCroppedAvatar(ctx.pendingAvatarBlob);
    ctx.pendingAvatarBlob = null;
    if (ctx.pendingAvatarPreviewUrl) {
        URL.revokeObjectURL(ctx.pendingAvatarPreviewUrl);
        ctx.pendingAvatarPreviewUrl = "";
    }
    avatarPreviewEl.src = buildAssetUrl(ctx.avatarFileId);
    submitText.textContent = registerI18n["submitting"] ?? "";
}

async function postRegistrationRequest(
    values: ReturnType<typeof collectFormValues>,
    avatarFileId: string,
): Promise<RegisterErrorPayload & { ok?: boolean }> {
    const payload = {
        email: values.email,
        username: values.username,
        display_name: values.displayName,
        password: values.password,
        registration_reason: values.registrationReason,
        avatar_file: avatarFileId || null,
    };
    const response = await fetch(API_REGISTER, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => null)) as
        | (RegisterErrorPayload & { ok?: boolean })
        | null;
    if (!response.ok || !data?.ok) {
        throw new Error(
            resolveRegisterError(
                data,
                registerI18n as Parameters<typeof resolveRegisterError>[1],
            ),
        );
    }
    return data;
}

async function handleFormSubmit(opts: SubmitHandlerOptions): Promise<void> {
    setPageMessage("", "normal");
    const values = collectFormValues(opts);
    const basicError = validateFormBasic(
        values,
        opts.passwordCheckPassedRef,
        opts.validators,
    );
    if (basicError) {
        setPageMessage(basicError, "error");
        return;
    }
    const [emailAvailable, usernameAvailable] = await Promise.all([
        opts.validators.validateEmailField(true),
        opts.validators.validateUsernameField(true),
    ]);
    if (!emailAvailable || !usernameAvailable) {
        setPageMessage(registerI18n["fixAccountFieldFirst"] ?? "", "error");
        return;
    }

    opts.submitBtn.disabled = true;
    opts.submitText.textContent = registerI18n["submitting"] ?? "";
    const overlayHandle = startOverlayTask({
        title: registerI18n["submitOverlayTitle"] ?? "",
        mode: "indeterminate",
        text: registerI18n["submitOverlayText"] ?? "",
    });
    try {
        await uploadPendingAvatarIfNeeded(opts, overlayHandle);
        updateOverlayTask(overlayHandle, {
            text: registerI18n["submitRequestOverlayText"] ?? "",
        });
        await postRegistrationRequest(values, opts.ctx.avatarFileId);
        updateOverlayTask(overlayHandle, {
            text: registerI18n["submitSuccessRedirecting"] ?? "",
        });
        window.location.assign("/auth/register");
    } catch (error) {
        setPageMessage(
            error instanceof Error
                ? error.message
                : (registerI18n["submitFailedRetry"] ?? ""),
            "error",
        );
    } finally {
        opts.submitBtn.disabled = false;
        opts.submitText.textContent = registerI18n["submitButtonText"] ?? "";
        finishOverlayTask(overlayHandle);
    }
}

// ── initRegisterPage 辅助 ──

type RegisterPageElements = {
    form: HTMLElement;
    emailEl: HTMLInputElement;
    emailHintEl: Element;
    usernameEl: HTMLInputElement;
    usernameHintEl: Element;
    displayNameEl: HTMLInputElement;
    passwordEl: HTMLInputElement;
    passwordHintEl: Element;
    passwordToggleEl: HTMLButtonElement;
    reasonEl: HTMLTextAreaElement;
    submitBtn: HTMLButtonElement;
    submitText: HTMLElement;
    avatarPreviewEl: HTMLImageElement;
    avatarUploadBtn: HTMLElement;
    avatarClearBtn: HTMLElement;
    cropEls: AvatarCropElements;
};

type FormFieldElements = Pick<
    RegisterPageElements,
    | "form"
    | "emailEl"
    | "emailHintEl"
    | "usernameEl"
    | "usernameHintEl"
    | "displayNameEl"
    | "passwordEl"
    | "passwordHintEl"
    | "passwordToggleEl"
    | "reasonEl"
>;

type FormActionElements = Pick<
    RegisterPageElements,
    | "submitBtn"
    | "submitText"
    | "avatarPreviewEl"
    | "avatarUploadBtn"
    | "avatarClearBtn"
>;

function queryFormFieldElements(): FormFieldElements | null {
    const form = document.getElementById("register-form");
    const emailEl = document.getElementById(
        "register-email",
    ) as HTMLInputElement | null;
    const emailHintEl = document.getElementById("register-email-hint");
    const usernameEl = document.getElementById(
        "register-username",
    ) as HTMLInputElement | null;
    const usernameHintEl = document.getElementById("register-username-hint");
    const displayNameEl = document.getElementById(
        "register-display-name",
    ) as HTMLInputElement | null;
    const passwordEl = document.getElementById(
        "register-password",
    ) as HTMLInputElement | null;
    const passwordHintEl = document.getElementById("register-password-hint");
    const passwordToggleEl = document.getElementById(
        "register-password-toggle",
    ) as HTMLButtonElement | null;
    const reasonEl = document.getElementById(
        "register-reason",
    ) as HTMLTextAreaElement | null;
    if (
        !form ||
        !emailEl ||
        !emailHintEl ||
        !usernameEl ||
        !usernameHintEl ||
        !displayNameEl ||
        !passwordEl ||
        !passwordHintEl ||
        !passwordToggleEl ||
        !reasonEl
    ) {
        return null;
    }
    return {
        form,
        emailEl,
        emailHintEl,
        usernameEl,
        usernameHintEl,
        displayNameEl,
        passwordEl,
        passwordHintEl,
        passwordToggleEl,
        reasonEl,
    };
}

function queryFormActionElements(): FormActionElements | null {
    const submitBtn = document.getElementById(
        "register-submit",
    ) as HTMLButtonElement | null;
    const submitText = document.getElementById("register-submit-text");
    const avatarPreviewEl = document.getElementById(
        "register-avatar-preview",
    ) as HTMLImageElement | null;
    const avatarUploadBtn = document.getElementById(
        "register-avatar-upload-btn",
    );
    const avatarClearBtn = document.getElementById("register-avatar-clear-btn");
    if (
        !submitBtn ||
        !submitText ||
        !avatarPreviewEl ||
        !avatarUploadBtn ||
        !avatarClearBtn
    ) {
        return null;
    }
    return {
        submitBtn,
        submitText,
        avatarPreviewEl,
        avatarUploadBtn,
        avatarClearBtn,
    };
}

function queryFormCoreElements(): Omit<RegisterPageElements, "cropEls"> | null {
    const fields = queryFormFieldElements();
    const actions = queryFormActionElements();
    if (!fields || !actions) {
        return null;
    }
    return { ...fields, ...actions };
}

function queryCropElements(): AvatarCropElements | null {
    const cropModal = document.getElementById("register-avatar-crop-modal");
    const cropViewport = document.getElementById(
        "register-avatar-crop-viewport",
    );
    const cropImage = document.getElementById(
        "register-avatar-crop-image",
    ) as HTMLImageElement | null;
    const cropEmpty = document.getElementById("register-avatar-crop-empty");
    const cropFileInput = document.getElementById(
        "register-avatar-crop-file",
    ) as HTMLInputElement | null;
    const cropSelectBtn = document.getElementById(
        "register-avatar-crop-select-btn",
    );
    const cropApplyBtn = document.getElementById(
        "register-avatar-crop-apply-btn",
    ) as HTMLButtonElement | null;
    const cropCancelBtn = document.getElementById(
        "register-avatar-crop-cancel-btn",
    );
    const cropZoomInput = document.getElementById(
        "register-avatar-crop-zoom",
    ) as HTMLInputElement | null;
    const cropMsg = document.getElementById("register-avatar-crop-msg");
    if (
        !cropModal ||
        !cropViewport ||
        !cropImage ||
        !cropEmpty ||
        !cropFileInput ||
        !cropSelectBtn ||
        !cropApplyBtn ||
        !cropCancelBtn ||
        !cropZoomInput ||
        !cropMsg
    ) {
        return null;
    }
    return {
        cropModal,
        cropViewport,
        cropImage,
        cropEmpty,
        cropFileInput,
        cropSelectBtn,
        cropApplyBtn,
        cropCancelBtn,
        cropZoomInput,
        cropMsg,
    };
}

function queryRegisterElements(): RegisterPageElements | null {
    const core = queryFormCoreElements();
    const cropEls = queryCropElements();
    if (!core || !cropEls) {
        return null;
    }
    return { ...core, cropEls };
}

function setupAvatarPreview(
    avatarPreviewEl: HTMLImageElement,
): (src: string) => void {
    const setAvatarPreviewSrc = (input: string): void => {
        const next = String(input || "").trim() || DEFAULT_AVATAR_SRC;
        avatarPreviewEl.dataset["fallbackApplied"] = "0";
        avatarPreviewEl.src = next;
    };
    avatarPreviewEl.addEventListener("error", () => {
        if (avatarPreviewEl.dataset["fallbackApplied"] === "1") {
            return;
        }
        avatarPreviewEl.dataset["fallbackApplied"] = "1";
        avatarPreviewEl.src = DEFAULT_AVATAR_SRC;
    });
    setAvatarPreviewSrc(DEFAULT_AVATAR_SRC);
    return setAvatarPreviewSrc;
}

function applyReapplyDraft(
    draft: ReturnType<typeof consumeReapplyDraft>,
    els: RegisterPageElements,
    ctx: AvatarCropContext,
    validators: FieldValidators,
    setAvatarPreviewSrc: (src: string) => void,
): void {
    if (!draft) return;
    if (draft.email) els.emailEl.value = draft.email;
    if (draft.username) els.usernameEl.value = draft.username;
    if (draft.displayName) els.displayNameEl.value = draft.displayName;
    if (draft.reason) els.reasonEl.value = draft.reason;
    if (draft.avatarFileId) {
        ctx.avatarFileId = draft.avatarFileId;
        ctx.pendingAvatarBlob = null;
        if (ctx.pendingAvatarPreviewUrl) {
            URL.revokeObjectURL(ctx.pendingAvatarPreviewUrl);
            ctx.pendingAvatarPreviewUrl = "";
        }
        setAvatarPreviewSrc(
            draft.avatarUrl || buildAssetUrl(draft.avatarFileId),
        );
    }
    void validators.validateEmailField(false);
    void validators.validateUsernameField(false);
    setPageMessage(registerI18n["reapplyDraftLoaded"] ?? "", "success");
}

function createInitialCropContext(): AvatarCropContext {
    return {
        avatarFileId: "",
        pendingAvatarBlob: null,
        pendingAvatarPreviewUrl: "",
        avatarUploading: false,
        cropObjectUrl: "",
        cropLoaded: false,
        cropImageWidth: 0,
        cropImageHeight: 0,
        cropViewportSize: 0,
        cropMinScale: 1,
        cropScale: 1,
        cropOffsetX: 0,
        cropOffsetY: 0,
        cropPointerId: null,
        cropPointerX: 0,
        cropPointerY: 0,
    };
}

// ── initRegisterPage ──

async function initRegisterPage(): Promise<void> {
    const form = document.getElementById("register-form");
    if (!form || form.hasAttribute(DATA_BOUND)) {
        return;
    }

    const els = queryRegisterElements();
    if (!els) {
        window.setTimeout(() => {
            if (!form.hasAttribute(DATA_BOUND)) {
                void initRegisterPage();
            }
        }, 0);
        return;
    }
    form.setAttribute(DATA_BOUND, "1");

    const setAvatarPreviewSrc = setupAvatarPreview(els.avatarPreviewEl);
    const ctx = createInitialCropContext();
    const passwordCheckPassedRef = { value: false };

    const formEls: FormElements = {
        emailEl: els.emailEl,
        emailHintEl: els.emailHintEl,
        usernameEl: els.usernameEl,
        usernameHintEl: els.usernameHintEl,
        passwordEl: els.passwordEl,
        passwordHintEl: els.passwordHintEl,
        passwordToggleEl: els.passwordToggleEl,
    };
    const validators = createFieldValidators(
        formEls,
        passwordCheckPassedRef,
        registerI18n,
    );

    const cropResult = buildCropSetupResult(
        els.cropEls,
        ctx,
        els.emailEl,
        setAvatarPreviewSrc,
        registerI18n,
    );

    els.avatarUploadBtn.addEventListener("click", cropResult.openCropModal);
    els.avatarClearBtn.addEventListener("click", () => {
        ctx.avatarFileId = "";
        ctx.pendingAvatarBlob = null;
        if (ctx.pendingAvatarPreviewUrl) {
            URL.revokeObjectURL(ctx.pendingAvatarPreviewUrl);
            ctx.pendingAvatarPreviewUrl = "";
        }
        setAvatarPreviewSrc(DEFAULT_AVATAR_SRC);
    });

    const reapplyDraft = consumeReapplyDraft(REAPPLY_DRAFT_STORAGE_KEY);
    applyReapplyDraft(reapplyDraft, els, ctx, validators, setAvatarPreviewSrc);

    els.form.addEventListener("submit", (event) => {
        event.preventDefault();
        void handleFormSubmit({
            form: els.form,
            emailEl: els.emailEl,
            usernameEl: els.usernameEl,
            displayNameEl: els.displayNameEl,
            passwordEl: els.passwordEl,
            reasonEl: els.reasonEl,
            submitBtn: els.submitBtn,
            submitText: els.submitText,
            avatarPreviewEl: els.avatarPreviewEl,
            validators,
            passwordCheckPassedRef,
            ctx,
            uploadCroppedAvatar: cropResult.uploadCroppedAvatar,
        });
    });
}

// ── 页面入口 ──

function initPage(): void {
    readPageConfig();
    DEFAULT_AVATAR_SRC = String(defaultAvatarPreviewSrc || "").trim();

    const oldCropModal = document.body.querySelector(
        ":scope > #register-avatar-crop-modal",
    );
    if (oldCropModal) {
        oldCropModal.remove();
    }
    const cropModal = document.getElementById("register-avatar-crop-modal");
    if (cropModal) {
        document.body.appendChild(cropModal);
    }

    const dialogs: StatusPageDialogs = {
        showNoticeDialog: (opts) =>
            (window as CialliWindow).showNoticeDialog(opts),
        showConfirmDialog: (opts) =>
            (window as CialliWindow).showConfirmDialog(opts),
    };

    bindCurrentAvatarFallback();
    void initRegisterPage();
    initRegistrationStatusPage(registerI18n, dialogs);
}

setupPageInit({
    key: "auth-register-page",
    init: initPage,
    stages: ["page-load"],
});
