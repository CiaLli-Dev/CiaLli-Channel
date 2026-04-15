/**
 * /me/ 账户设置页：输入控件与编辑按钮事件绑定。
 *
 * 从 me-page-profile-dom.ts 拆离，以将单文件行数保持在 ESLint 限制以内。
 */

import { DATA_BOUND } from "@/scripts/me/page-types";
import type { MePageDom, MePageState } from "@/scripts/me/page-types";
import {
    updateUsernameCounter,
    updateUsernameDisplay,
    updateBioCounter,
    updateBioDisplay,
    updateDisplaynameCounter,
    updateDisplaynameDisplay,
    setUsernameEditing,
    setBioEditing,
    setDisplaynameEditing,
    checkProfileDirty,
} from "@/scripts/me/page-profile-dom";

// ---------------------------------------------------------------------------
// 外部点击折叠
// ---------------------------------------------------------------------------

function collapseEditorOnOutsideClick(
    target: Node,
    editor: HTMLElement | null,
    displayBtn: HTMLElement | null,
    collapse: () => void,
): void {
    if (!editor || editor.classList.contains("hidden")) {
        return;
    }
    const insideEditor = editor.contains(target);
    const insideDisplay = displayBtn?.contains(target) ?? false;
    if (!insideEditor && !insideDisplay) {
        collapse();
    }
}

export function buildOutsideClickHandler(
    dom: MePageDom,
): (event: MouseEvent) => void {
    return (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }
        collapseEditorOnOutsideClick(
            target,
            dom.usernameEditor,
            dom.usernameDisplayBtn,
            () => setUsernameEditing(dom, false),
        );
        collapseEditorOnOutsideClick(
            target,
            dom.bioEditor,
            dom.bioDisplayBtn,
            () => setBioEditing(dom, false),
        );
        collapseEditorOnOutsideClick(
            target,
            dom.displaynameEditor,
            dom.displaynameDisplayBtn,
            () => setDisplaynameEditing(dom, false),
        );
    };
}

// ---------------------------------------------------------------------------
// 输入控件事件绑定
// ---------------------------------------------------------------------------

export function bindAllInputControls(dom: MePageDom, state: MePageState): void {
    if (dom.usernameInput && !dom.usernameInput.hasAttribute(DATA_BOUND)) {
        dom.usernameInput.setAttribute(DATA_BOUND, "");
        dom.usernameInput.addEventListener("input", () => {
            updateUsernameCounter(dom);
            updateUsernameDisplay(dom);
            checkProfileDirty(dom, state);
        });
    }

    if (dom.bioInput && !dom.bioInput.hasAttribute(DATA_BOUND)) {
        dom.bioInput.setAttribute(DATA_BOUND, "");
        dom.bioInput.addEventListener("input", () => {
            updateBioCounter(dom);
            updateBioDisplay(dom);
            checkProfileDirty(dom, state);
        });
    }

    if (
        dom.displaynameInput &&
        !dom.displaynameInput.hasAttribute(DATA_BOUND)
    ) {
        dom.displaynameInput.setAttribute(DATA_BOUND, "");
        dom.displaynameInput.addEventListener("input", () => {
            updateDisplaynameCounter(dom);
            updateDisplaynameDisplay(dom);
            checkProfileDirty(dom, state);
        });
    }
}

export function bindEditToggleButtons(dom: MePageDom): void {
    if (
        dom.usernameDisplayBtn &&
        !dom.usernameDisplayBtn.hasAttribute(DATA_BOUND)
    ) {
        dom.usernameDisplayBtn.setAttribute(DATA_BOUND, "");
        dom.usernameDisplayBtn.addEventListener("click", () =>
            setUsernameEditing(dom, true, true),
        );
    }

    if (dom.bioDisplayBtn && !dom.bioDisplayBtn.hasAttribute(DATA_BOUND)) {
        dom.bioDisplayBtn.setAttribute(DATA_BOUND, "");
        dom.bioDisplayBtn.addEventListener("click", () =>
            setBioEditing(dom, true, true),
        );
    }

    if (
        dom.displaynameDisplayBtn &&
        !dom.displaynameDisplayBtn.hasAttribute(DATA_BOUND)
    ) {
        dom.displaynameDisplayBtn.setAttribute(DATA_BOUND, "");
        dom.displaynameDisplayBtn.addEventListener("click", () =>
            setDisplaynameEditing(dom, true, true),
        );
    }
}
