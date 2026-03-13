/**
 * /auth/login 页面运行逻辑。
 *
 * 从原始 `<script is:inline define:vars>` 提取，支持 Astro 页面切换后重新初始化。
 * i18n 字符串通过 form 元素的 data-i18n-* 属性传入，无需 define:vars。
 */

const API_LOGIN = "/api/auth/login";

// ---------------------------------------------------------------------------
// DOM / CSRF 工具
// ---------------------------------------------------------------------------

function getCsrfToken(): string {
    const element = document.querySelector('meta[name="cialli-csrf-token"]');
    if (!(element instanceof HTMLMetaElement)) {
        return "";
    }
    return element.content || "";
}

// ---------------------------------------------------------------------------
// 重定向目标解析
// ---------------------------------------------------------------------------

function normalizeRedirectTarget(redirect: string | null): string {
    const candidate = String(redirect ?? "").trim();
    if (
        !candidate ||
        !candidate.startsWith("/") ||
        candidate.startsWith("//")
    ) {
        return "/";
    }
    if (candidate === "/auth/login" || candidate === "/login") {
        return "/";
    }
    return candidate;
}

function getRedirectTarget(): string {
    try {
        const u = new URL(window.location.href);
        return normalizeRedirectTarget(u.searchParams.get("redirect"));
    } catch {
        return "/";
    }
}

// ---------------------------------------------------------------------------
// 错误提示
// ---------------------------------------------------------------------------

function setError(message: string): void {
    const errorEl = document.getElementById("login-error");
    if (!errorEl) {
        return;
    }
    if (message) {
        errorEl.textContent = message;
        errorEl.classList.remove("hidden");
    } else {
        errorEl.textContent = "";
        errorEl.classList.add("hidden");
    }
}

// ---------------------------------------------------------------------------
// 读取 i18n 字符串（来自 form data-i18n-* 属性）
// ---------------------------------------------------------------------------

interface LoginI18n {
    hidePassword: string;
    showPassword: string;
    emptyCredentials: string;
    loggingIn: string;
    loginFailed: string;
    loginSubmit: string;
}

function readI18n(form: HTMLFormElement): LoginI18n {
    const d = form.dataset;
    return {
        hidePassword: d.i18nHidePassword ?? "",
        showPassword: d.i18nShowPassword ?? "",
        emptyCredentials: d.i18nEmptyCredentials ?? "",
        loggingIn: d.i18nLoggingIn ?? "",
        loginFailed: d.i18nLoginFailed ?? "",
        loginSubmit: d.i18nLoginSubmit ?? "",
    };
}

// ---------------------------------------------------------------------------
// 提交逻辑辅助函数（拆分以降低复杂度）
// ---------------------------------------------------------------------------

function getSubmitElements(form: HTMLFormElement): {
    emailEl: HTMLInputElement;
    pwdEl: HTMLInputElement;
    rememberEl: HTMLInputElement;
    submitBtn: HTMLButtonElement;
} | null {
    const emailEl = form.querySelector<HTMLInputElement>("#login-email");
    const pwdEl = form.querySelector<HTMLInputElement>("#login-password");
    const rememberEl = form.querySelector<HTMLInputElement>("#login-remember");
    const submitBtn = form.querySelector<HTMLButtonElement>("#login-submit");
    if (!emailEl || !pwdEl || !rememberEl || !submitBtn) {
        return null;
    }
    return { emailEl, pwdEl, rememberEl, submitBtn };
}

function setSubmitLoading(
    submitBtn: HTMLButtonElement,
    loading: boolean,
    i18n: LoginI18n,
): void {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle("is-loading", loading);
    const textEl = submitBtn.querySelector(".login-submit-text");
    if (textEl) {
        textEl.textContent = loading ? i18n.loggingIn : i18n.loginSubmit;
    }
}

interface LoginResponseData {
    ok?: boolean;
    message?: string;
    error?: { message?: string };
}

async function performLogin(
    email: string,
    password: string,
    remember: boolean,
): Promise<LoginResponseData | null> {
    const resp = await fetch(API_LOGIN, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({ email, password, remember }),
    });
    const data: LoginResponseData | null = (await resp
        .json()
        .catch(() => null)) as LoginResponseData | null;
    if (!resp.ok || !data?.ok) {
        return data;
    }
    return null;
}

function createSubmitHandler(
    form: HTMLFormElement,
    i18n: LoginI18n,
): (e: SubmitEvent) => Promise<void> {
    return async (e: SubmitEvent): Promise<void> => {
        e.preventDefault();
        setError("");

        const elements = getSubmitElements(form);
        if (!elements) {
            return;
        }
        const { emailEl, pwdEl, rememberEl, submitBtn } = elements;

        const email = String(emailEl.value || "").trim();
        const password = String(pwdEl.value || "");
        if (!email || !password) {
            setError(i18n.emptyCredentials);
            return;
        }

        setSubmitLoading(submitBtn, true, i18n);
        try {
            const errorData = await performLogin(
                email,
                password,
                rememberEl.checked,
            );
            if (errorData !== null) {
                setError(
                    errorData?.message ??
                        errorData?.error?.message ??
                        i18n.loginFailed,
                );
                return;
            }
            window.location.href = getRedirectTarget();
        } catch (err) {
            console.error("Login failed:", err);
            setError(i18n.loginFailed);
        } finally {
            setSubmitLoading(submitBtn, false, i18n);
        }
    };
}

// ---------------------------------------------------------------------------
// 密码显示切换
// ---------------------------------------------------------------------------

function bindPasswordToggle(
    pwdEl: HTMLInputElement,
    passwordToggleEl: HTMLButtonElement,
    i18n: LoginI18n,
): void {
    passwordToggleEl.addEventListener("click", () => {
        const isPassword = pwdEl.type === "password";
        pwdEl.type = isPassword ? "text" : "password";
        pwdEl.classList.toggle("is-masked", !isPassword);
        passwordToggleEl
            .querySelector(".login-password-icon-show")
            ?.classList.toggle("hidden", isPassword);
        passwordToggleEl
            .querySelector(".login-password-icon-hide")
            ?.classList.toggle("hidden", !isPassword);
        passwordToggleEl.setAttribute(
            "aria-label",
            isPassword ? i18n.hidePassword : i18n.showPassword,
        );
        passwordToggleEl.setAttribute(
            "aria-pressed",
            isPassword ? "true" : "false",
        );
    });
}

// ---------------------------------------------------------------------------
// 页面初始化
// ---------------------------------------------------------------------------

function initLoginForm(): void {
    const form = document.getElementById("login-form");
    const pwdEl = document.getElementById("login-password");
    const passwordToggleEl = document.getElementById("login-password-toggle");

    if (
        !(form instanceof HTMLFormElement) ||
        !(pwdEl instanceof HTMLInputElement) ||
        !(passwordToggleEl instanceof HTMLButtonElement)
    ) {
        return;
    }

    if (form.dataset.bound) {
        return;
    }
    form.dataset.bound = "1";

    const i18n = readI18n(form);

    bindPasswordToggle(pwdEl, passwordToggleEl, i18n);
    form.addEventListener(
        "submit",
        createSubmitHandler(form, i18n) as EventListener,
    );
}

export function init(): void {
    initLoginForm();
    document.addEventListener("astro:after-swap", initLoginForm);
}
