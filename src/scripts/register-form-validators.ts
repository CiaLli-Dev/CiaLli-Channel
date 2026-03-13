/**
 * 注册表单字段验证器
 *
 * 包含 email、username、password 三个字段的实时校验与防抖检查逻辑。
 */

import {
    type RegisterErrorPayload,
    resolveRegisterError,
    setFieldHint,
} from "@/scripts/register-page-helpers";

// ── 常量 ──

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const PASSWORD_PATTERN = /^[A-Za-z0-9@_]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 20;
const ACCOUNT_CHECK_DEBOUNCE_MS = 2000;
const API_REGISTER_CHECK = "/api/v1/public/registration-check";

// ── 类型 ──

export type FieldValidators = {
    validateEmailField: (force?: boolean) => Promise<boolean>;
    validateUsernameField: (force?: boolean) => Promise<boolean>;
    validatePasswordField: (force?: boolean) => boolean;
};

export type FormElements = {
    emailEl: HTMLInputElement;
    emailHintEl: Element;
    usernameEl: HTMLInputElement;
    usernameHintEl: Element;
    passwordEl: HTMLInputElement;
    passwordHintEl: Element;
    passwordToggleEl: HTMLButtonElement;
};

// ── 注册 check API ──

async function requestRegistrationCheck(
    params: { email?: string; username?: string },
    i18n: Record<string, string>,
): Promise<Record<string, unknown>> {
    const searchParams = new URLSearchParams();
    if (params.email) {
        searchParams.set("email", params.email);
    }
    if (params.username) {
        searchParams.set("username", params.username);
    }
    const response = await fetch(
        `${API_REGISTER_CHECK}?${searchParams.toString()}`,
        {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
        },
    );
    const data = (await response
        .json()
        .catch(() => null)) as RegisterErrorPayload | null;
    if (!response.ok || !(data as Record<string, unknown> | null)?.["ok"]) {
        throw new Error(
            resolveRegisterError(
                data,
                i18n as Parameters<typeof resolveRegisterError>[1],
            ),
        );
    }
    return data as Record<string, unknown>;
}

// ── 通用字段检查结果处理 ──

type FieldCheckResult = {
    valid?: boolean;
    available?: boolean;
    error?: { message?: string };
};

function applyEmailCheckResult(
    result: FieldCheckResult | undefined,
    hintEl: Element,
    i18n: Record<string, string>,
): boolean {
    if (result?.valid && result?.available) {
        setFieldHint(hintEl, i18n["emailAvailable"] ?? "", "success");
        return true;
    }
    setFieldHint(
        hintEl,
        result?.error?.message || i18n["emailUnavailable"] || "",
        "error",
    );
    return false;
}

function applyUsernameCheckResult(
    result: FieldCheckResult | undefined,
    hintEl: Element,
    i18n: Record<string, string>,
): boolean {
    if (result?.valid && result?.available) {
        setFieldHint(hintEl, i18n["usernameAvailable"] ?? "", "success");
        return true;
    }
    setFieldHint(
        hintEl,
        result?.error?.message || i18n["usernameUnavailable"] || "",
        "error",
    );
    return false;
}

// ── email 验证内部 run ──

async function runEmailCheck(
    value: string,
    emailHintEl: Element,
    seqRef: { value: number },
    i18n: Record<string, string>,
): Promise<boolean> {
    const currentSeq = ++seqRef.value;
    setFieldHint(emailHintEl, i18n["checking"] ?? "", "loading");
    try {
        const data = await requestRegistrationCheck({ email: value }, i18n);
        if (currentSeq !== seqRef.value) {
            return false;
        }
        return applyEmailCheckResult(
            data["email"] as FieldCheckResult | undefined,
            emailHintEl,
            i18n,
        );
    } catch (error) {
        if (currentSeq !== seqRef.value) {
            return false;
        }
        setFieldHint(
            emailHintEl,
            error instanceof Error
                ? error.message
                : (i18n["emailCheckFailed"] ?? ""),
            "error",
        );
        return false;
    }
}

// ── username 验证内部 run ──

async function runUsernameCheck(
    value: string,
    usernameHintEl: Element,
    seqRef: { value: number },
    i18n: Record<string, string>,
): Promise<boolean> {
    const currentSeq = ++seqRef.value;
    setFieldHint(usernameHintEl, i18n["checking"] ?? "", "loading");
    try {
        const data = await requestRegistrationCheck({ username: value }, i18n);
        if (currentSeq !== seqRef.value) {
            return false;
        }
        return applyUsernameCheckResult(
            data["username"] as FieldCheckResult | undefined,
            usernameHintEl,
            i18n,
        );
    } catch (error) {
        if (currentSeq !== seqRef.value) {
            return false;
        }
        setFieldHint(
            usernameHintEl,
            error instanceof Error
                ? error.message
                : (i18n["usernameCheckFailed"] ?? ""),
            "error",
        );
        return false;
    }
}

// ── 密码可见性切换 ──

function bindPasswordToggle(
    passwordEl: HTMLInputElement,
    passwordToggleEl: HTMLButtonElement,
    i18n: Record<string, string>,
): void {
    const setPasswordVisible = (visible: boolean): void => {
        const nextType = visible ? "text" : "password";
        try {
            passwordEl.type = nextType;
        } catch {
            // ignore
        }
        const actuallyVisible = passwordEl.type === "text";
        passwordToggleEl
            .querySelector(".register-password-icon-show")
            ?.classList.toggle("hidden", actuallyVisible);
        passwordToggleEl
            .querySelector(".register-password-icon-hide")
            ?.classList.toggle("hidden", !actuallyVisible);
        passwordToggleEl.setAttribute(
            "aria-label",
            actuallyVisible
                ? (i18n["hidePassword"] ?? "")
                : (i18n["showPassword"] ?? ""),
        );
        passwordToggleEl.setAttribute(
            "aria-pressed",
            actuallyVisible ? "true" : "false",
        );
    };

    setPasswordVisible(false);

    passwordToggleEl.addEventListener("pointerdown", (event) => {
        event.preventDefault();
    });
    passwordToggleEl.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setPasswordVisible(passwordEl.type === "password");
    });
}

// ── 公开工厂函数 ──

export function createFieldValidators(
    els: FormElements,
    passwordCheckPassedRef: { value: boolean },
    i18n: Record<string, string>,
): FieldValidators {
    const {
        emailEl,
        emailHintEl,
        usernameEl,
        usernameHintEl,
        passwordEl,
        passwordHintEl,
        passwordToggleEl,
    } = els;

    const emailSeqRef = { value: 0 };
    const usernameSeqRef = { value: 0 };
    let emailCheckTimer = 0;
    let usernameCheckTimer = 0;

    const validateEmailField = async (force = false): Promise<boolean> => {
        const value = String(emailEl.value || "").trim();
        window.clearTimeout(emailCheckTimer);
        if (!force) {
            emailSeqRef.value += 1;
        }
        if (!value) {
            setFieldHint(emailHintEl, i18n["emailRequired"] ?? "", "default");
            return false;
        }
        if (!EMAIL_PATTERN.test(value)) {
            setFieldHint(emailHintEl, i18n["emailInvalid"] ?? "", "error");
            return false;
        }
        if (force) {
            return runEmailCheck(value, emailHintEl, emailSeqRef, i18n);
        }
        emailCheckTimer = window.setTimeout(() => {
            emailCheckTimer = 0;
            void runEmailCheck(value, emailHintEl, emailSeqRef, i18n);
        }, ACCOUNT_CHECK_DEBOUNCE_MS);
        return false;
    };

    const validateUsernameField = async (force = false): Promise<boolean> => {
        const value = String(usernameEl.value || "").trim();
        window.clearTimeout(usernameCheckTimer);
        if (!force) {
            usernameSeqRef.value += 1;
        }
        if (!value) {
            setFieldHint(
                usernameHintEl,
                i18n["usernameRequired"] ?? "",
                "default",
            );
            return false;
        }
        if (!USERNAME_PATTERN.test(value)) {
            setFieldHint(usernameHintEl, i18n["usernameRule"] ?? "", "error");
            return false;
        }
        if (value.length > 14) {
            setFieldHint(
                usernameHintEl,
                i18n["usernameTooLong"] ?? "",
                "error",
            );
            return false;
        }
        if (force) {
            return runUsernameCheck(
                value,
                usernameHintEl,
                usernameSeqRef,
                i18n,
            );
        }
        usernameCheckTimer = window.setTimeout(() => {
            usernameCheckTimer = 0;
            void runUsernameCheck(value, usernameHintEl, usernameSeqRef, i18n);
        }, ACCOUNT_CHECK_DEBOUNCE_MS);
        return false;
    };

    const validatePasswordField = (force = false): boolean => {
        const value = String(passwordEl.value || "");
        const trimmed = value.trim();
        passwordCheckPassedRef.value = false;
        if (!trimmed) {
            setFieldHint(
                passwordHintEl,
                force
                    ? (i18n["passwordEmpty"] ?? "")
                    : (i18n["passwordSetHint"] ?? ""),
                force ? "error" : "default",
            );
            return false;
        }
        if (value.length < PASSWORD_MIN_LENGTH) {
            setFieldHint(
                passwordHintEl,
                i18n["passwordTooShort"] ?? "",
                "error",
            );
            return false;
        }
        if (value.length > PASSWORD_MAX_LENGTH) {
            setFieldHint(
                passwordHintEl,
                i18n["passwordTooLong"] ?? "",
                "error",
            );
            return false;
        }
        if (!PASSWORD_PATTERN.test(value)) {
            setFieldHint(
                passwordHintEl,
                i18n["passwordInvalid"] ?? "",
                "error",
            );
            return false;
        }
        passwordCheckPassedRef.value = true;
        setFieldHint(
            passwordHintEl,
            i18n["passwordLengthValid"] ?? "",
            "success",
        );
        return true;
    };

    bindPasswordToggle(passwordEl, passwordToggleEl, i18n);

    emailEl.addEventListener("input", () => {
        void validateEmailField(false);
    });
    emailEl.addEventListener("blur", () => {
        void validateEmailField(true);
    });
    usernameEl.addEventListener("input", () => {
        void validateUsernameField(false);
    });
    usernameEl.addEventListener("blur", () => {
        void validateUsernameField(true);
    });
    passwordEl.addEventListener("input", () => {
        validatePasswordField(false);
    });
    passwordEl.addEventListener("blur", () => {
        validatePasswordField(true);
    });

    return { validateEmailField, validateUsernameField, validatePasswordField };
}
