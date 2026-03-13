/* eslint-disable max-lines -- 通用弹窗需要集中维护字段、内容与动作渲染，避免状态分散。 */
export type OverlayDialogActionVariant = "primary" | "secondary" | "danger";
export type OverlayDialogActionKind = "button" | "link";

export type OverlayDialogAction = {
    key: string;
    label: string;
    variant: OverlayDialogActionVariant;
    kind?: OverlayDialogActionKind;
    href?: string;
};

export type OverlayDialogFieldOption = {
    label: string;
    value: string;
};

export type OverlayDialogField = {
    name: string;
    label: string;
    labelHighlightText?: string;
    labelSuffix?: string;
    kind: "input" | "textarea" | "select";
    required?: boolean;
    placeholder?: string;
    value?: string;
    rows?: number;
    options?: OverlayDialogFieldOption[];
    hint?: string;
    hintTone?: "default" | "primary" | "danger";
};

export type OverlayDialogContent = {
    label: string;
    value: string;
    tone?: "default" | "primary" | "danger";
    fullWidth?: boolean;
};

export type OverlayDialogActionGuardResult = {
    message?: string;
    invalidFieldNames?: string[];
};

export type OverlayDialogOptions = {
    ariaLabel: string;
    message: string;
    actions: OverlayDialogAction[];
    dismissKey: string | null;
    content?: OverlayDialogContent[];
    contentColumns?: 1 | 2;
    fields?: OverlayDialogField[];
    actionGuard?: (
        actionKey: string,
        values: Record<string, string>,
    ) => OverlayDialogActionGuardResult | null;
};

export type OverlayDialogResult = {
    actionKey: string;
    values: Record<string, string>;
};

type OverlayDialogControl = {
    name: string;
    required: boolean;
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
};

let overlayEl: HTMLElement | null = null;
let messageEl: HTMLElement | null = null;
let contentEl: HTMLElement | null = null;
let fieldsEl: HTMLElement | null = null;
let errorEl: HTMLElement | null = null;
let actionsEl: HTMLElement | null = null;
let savedOverflow = "";
let activeResolve: ((result: OverlayDialogResult) => void) | null = null;
let activeDismissKey: string | null = null;
let fieldControls: OverlayDialogControl[] = [];

function resetDetachedDialogState(): void {
    // Astro 客户端切页会替换 body，单例弹窗节点会变成悬空引用。
    // 这里在重建前主动回收旧状态，避免后续 Promise 永远不 resolve。
    document.removeEventListener("keydown", onKeyDown);
    resolveActive({
        actionKey: activeDismissKey || "dismiss",
        values: {},
    });
    overlayEl = null;
    messageEl = null;
    contentEl = null;
    fieldsEl = null;
    errorEl = null;
    actionsEl = null;
    activeDismissKey = null;
    fieldControls = [];
    savedOverflow = "";
}

function ensureDOM(): void {
    if (overlayEl?.isConnected) {
        return;
    }
    if (overlayEl && !overlayEl.isConnected) {
        resetDetachedDialogState();
    }

    overlayEl = document.createElement("div");
    overlayEl.className = "overlay-dialog";
    overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-modal", "true");
    overlayEl.setAttribute("aria-label", "提示");
    overlayEl.hidden = true;

    const card = document.createElement("div");
    card.className = "overlay-dialog-card";

    const bodyEl = document.createElement("div");
    bodyEl.className = "overlay-dialog-body";

    messageEl = document.createElement("p");
    messageEl.className = "overlay-dialog-message";

    contentEl = document.createElement("div");
    contentEl.className = "overlay-dialog-content";
    contentEl.hidden = true;

    fieldsEl = document.createElement("div");
    fieldsEl.className = "overlay-dialog-fields";
    fieldsEl.hidden = true;

    errorEl = document.createElement("p");
    errorEl.className = "overlay-dialog-error";
    errorEl.hidden = true;

    actionsEl = document.createElement("div");
    actionsEl.className = "overlay-dialog-actions";

    bodyEl.appendChild(messageEl);
    bodyEl.appendChild(contentEl);
    bodyEl.appendChild(fieldsEl);
    bodyEl.appendChild(errorEl);
    card.appendChild(bodyEl);
    card.appendChild(actionsEl);
    overlayEl.appendChild(card);

    overlayEl.addEventListener("click", (event) => {
        if (event.target === overlayEl && activeDismissKey) {
            hide(activeDismissKey, collectFieldValues());
        }
    });

    document.body.appendChild(overlayEl);
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && activeDismissKey) {
        event.preventDefault();
        hide(activeDismissKey, collectFieldValues());
    }
}

function resolveActive(result: OverlayDialogResult): void {
    if (!activeResolve) {
        return;
    }
    const resolve = activeResolve;
    activeResolve = null;
    resolve(result);
}

function getActionClassName(variant: OverlayDialogActionVariant): string {
    if (variant === "primary") {
        return "overlay-dialog-action-primary";
    }
    if (variant === "danger") {
        return "overlay-dialog-action-danger";
    }
    return "overlay-dialog-action-secondary";
}

function closeWithoutAnimation(result?: OverlayDialogResult): void {
    if (!overlayEl) {
        return;
    }
    overlayEl.hidden = true;
    overlayEl.classList.remove("is-closing");
    document.body.style.overflow = savedOverflow;
    document.removeEventListener("keydown", onKeyDown);
    activeDismissKey = null;
    fieldControls = [];

    if (result) {
        resolveActive(result);
    }
}

function hide(actionKey?: string, values?: Record<string, string>): void {
    if (!overlayEl || overlayEl.hidden) {
        if (actionKey) {
            resolveActive({
                actionKey,
                values: values || {},
            });
        }
        return;
    }

    if (actionKey) {
        resolveActive({
            actionKey,
            values: values || {},
        });
    }

    overlayEl.classList.add("is-closing");
    document.removeEventListener("keydown", onKeyDown);

    let closed = false;
    const finishClose = () => {
        if (closed) {
            return;
        }
        closed = true;
        closeWithoutAnimation();
    };

    overlayEl.addEventListener("animationend", finishClose, { once: true });
    window.setTimeout(finishClose, 220);
}

function createFieldControl(field: OverlayDialogField): OverlayDialogControl {
    if (field.kind === "textarea") {
        const textarea = document.createElement("textarea");
        textarea.className = "overlay-dialog-field-control";
        textarea.rows = Number.isFinite(field.rows)
            ? Math.max(2, Number(field.rows))
            : 4;
        textarea.placeholder = field.placeholder || "";
        textarea.value = field.value || "";
        textarea.required = Boolean(field.required);
        return {
            name: field.name,
            required: Boolean(field.required),
            element: textarea,
        };
    }

    if (field.kind === "select") {
        const select = document.createElement("select");
        select.className = "overlay-dialog-field-control";
        select.required = Boolean(field.required);

        for (const option of field.options || []) {
            const item = document.createElement("option");
            item.value = option.value;
            item.textContent = option.label;
            select.appendChild(item);
        }

        if (field.value) {
            select.value = field.value;
        }

        return {
            name: field.name,
            required: Boolean(field.required),
            element: select,
        };
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "overlay-dialog-field-control";
    input.placeholder = field.placeholder || "";
    input.value = field.value || "";
    input.required = Boolean(field.required);
    return {
        name: field.name,
        required: Boolean(field.required),
        element: input,
    };
}

function clearDialogError(): void {
    if (!errorEl) {
        return;
    }
    errorEl.textContent = "";
    errorEl.hidden = true;
}

function setDialogError(message: string): void {
    if (!errorEl) {
        return;
    }
    const content = String(message || "").trim();
    if (!content) {
        clearDialogError();
        return;
    }
    errorEl.textContent = content;
    errorEl.hidden = false;
}

function renderFields(fields: OverlayDialogField[] | undefined): void {
    if (!fieldsEl) {
        return;
    }

    fieldsEl.replaceChildren();
    fieldControls = [];

    if (!fields || fields.length === 0) {
        fieldsEl.hidden = true;
        return;
    }

    fieldsEl.hidden = false;
    for (const field of fields) {
        const group = document.createElement("label");
        group.className = "overlay-dialog-field";

        const label = document.createElement("span");
        label.className = "overlay-dialog-field-label";
        label.textContent = "";
        const labelPrefix = document.createElement("span");
        labelPrefix.textContent = field.label;
        label.appendChild(labelPrefix);
        if (field.labelHighlightText) {
            const highlight = document.createElement("span");
            highlight.className = "overlay-dialog-field-label-highlight";
            highlight.textContent = field.labelHighlightText;
            label.appendChild(highlight);
        }
        if (field.labelSuffix) {
            const suffix = document.createElement("span");
            suffix.textContent = field.labelSuffix;
            label.appendChild(suffix);
        }

        const control = createFieldControl(field);
        control.element.addEventListener("input", () => {
            control.element.classList.remove("is-invalid");
            clearDialogError();
        });
        control.element.addEventListener("change", () => {
            control.element.classList.remove("is-invalid");
            clearDialogError();
        });

        group.appendChild(label);
        group.appendChild(control.element);
        if (field.hint) {
            const hint = document.createElement("span");
            hint.className =
                field.hintTone === "primary"
                    ? "overlay-dialog-field-hint overlay-dialog-field-hint-primary"
                    : field.hintTone === "danger"
                      ? "overlay-dialog-field-hint overlay-dialog-field-hint-danger"
                      : "overlay-dialog-field-hint";
            hint.textContent = field.hint;
            group.appendChild(hint);
        }
        fieldsEl.appendChild(group);
        fieldControls.push(control);
    }
}

function renderContent(
    content: OverlayDialogContent[] | undefined,
    contentColumns: 1 | 2 = 1,
): void {
    if (!contentEl) {
        return;
    }

    contentEl.replaceChildren();
    contentEl.classList.toggle(
        "overlay-dialog-content-two-columns",
        contentColumns === 2,
    );
    if (!content || content.length === 0) {
        contentEl.hidden = true;
        return;
    }

    contentEl.hidden = false;
    for (const item of content) {
        const block = document.createElement("section");
        block.className =
            item.tone === "primary"
                ? "overlay-dialog-content-item overlay-dialog-content-item-primary"
                : item.tone === "danger"
                  ? "overlay-dialog-content-item overlay-dialog-content-item-danger"
                  : "overlay-dialog-content-item";
        if (item.fullWidth) {
            block.classList.add("overlay-dialog-content-item-full");
        }

        const label = document.createElement("p");
        label.className = "overlay-dialog-content-label";
        label.textContent = item.label;

        const value = document.createElement("p");
        value.className = "overlay-dialog-content-value";
        value.textContent = String(item.value || "").trim() || "无";

        block.appendChild(label);
        block.appendChild(value);
        contentEl.appendChild(block);
    }
}

function collectFieldValues(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const control of fieldControls) {
        values[control.name] = String(control.element.value || "").trim();
    }
    return values;
}

function validateFields(actionKey: string): boolean {
    if (activeDismissKey && actionKey === activeDismissKey) {
        return true;
    }

    let firstInvalid:
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null = null;

    for (const control of fieldControls) {
        if (!control.required) {
            control.element.classList.remove("is-invalid");
            continue;
        }

        const valid = String(control.element.value || "").trim().length > 0;
        control.element.classList.toggle("is-invalid", !valid);
        if (!valid && !firstInvalid) {
            firstInvalid = control.element;
        }
    }

    if (firstInvalid) {
        firstInvalid.focus();
        return false;
    }
    return true;
}

function renderActions(
    actions: OverlayDialogAction[],
    actionGuard?: OverlayDialogOptions["actionGuard"],
): void {
    if (!actionsEl) {
        return;
    }

    actionsEl.replaceChildren();
    for (const action of actions) {
        const kind = action.kind || "button";
        const className = getActionClassName(action.variant);

        if (kind === "link") {
            const link = document.createElement("a");
            link.className = className;
            link.textContent = action.label;
            link.href = action.href || "#";
            link.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const values = collectFieldValues();
                closeWithoutAnimation({
                    actionKey: action.key,
                    values,
                });
                if (action.href && action.href !== "#") {
                    window.location.assign(action.href);
                }
            });
            actionsEl.appendChild(link);
            continue;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = action.label;
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!validateFields(action.key)) {
                return;
            }
            const values = collectFieldValues();
            if (actionGuard) {
                const guardResult = actionGuard(action.key, values);
                if (guardResult) {
                    setDialogError(guardResult.message || "");
                    const invalidFieldNames = Array.isArray(
                        guardResult.invalidFieldNames,
                    )
                        ? guardResult.invalidFieldNames
                        : [];
                    let firstInvalidControl: OverlayDialogControl | null = null;
                    for (const control of fieldControls) {
                        const isInvalid = invalidFieldNames.includes(
                            control.name,
                        );
                        control.element.classList.toggle(
                            "is-invalid",
                            isInvalid,
                        );
                        if (isInvalid && !firstInvalidControl) {
                            firstInvalidControl = control;
                        }
                    }
                    if (firstInvalidControl) {
                        firstInvalidControl.element.focus();
                    }
                    return;
                }
            }
            clearDialogError();
            if (activeDismissKey && action.key === activeDismissKey) {
                closeWithoutAnimation({
                    actionKey: action.key,
                    values,
                });
                return;
            }
            hide(action.key, values);
        });
        actionsEl.appendChild(button);
    }
}

export function showOverlayDialog(
    options: OverlayDialogOptions,
): Promise<OverlayDialogResult> {
    ensureDOM();
    if (!overlayEl || !messageEl || !contentEl || !fieldsEl || !actionsEl) {
        return Promise.resolve({
            actionKey: options.dismissKey || "",
            values: {},
        });
    }

    if (activeResolve) {
        closeWithoutAnimation({
            actionKey: activeDismissKey || "dismiss",
            values: {},
        });
    }

    overlayEl.setAttribute("aria-label", options.ariaLabel);
    messageEl.textContent = options.message;
    clearDialogError();
    renderContent(options.content, options.contentColumns || 1);
    renderFields(options.fields);
    renderActions(options.actions, options.actionGuard);
    activeDismissKey = options.dismissKey;

    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    overlayEl.classList.remove("is-closing");
    overlayEl.hidden = false;
    document.addEventListener("keydown", onKeyDown);

    return new Promise<OverlayDialogResult>((resolve) => {
        activeResolve = resolve;
    });
}
