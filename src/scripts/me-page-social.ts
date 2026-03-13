/**
 * /me/ 账户设置页：社交链接 DOM 构建与数据收集。
 */

import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    SOCIAL_PLATFORMS,
    SOCIAL_PLATFORM_LABELS,
} from "@/scripts/me-page-types";
import type { MePageDom, SocialLink } from "@/scripts/me-page-types";

export type { SocialLink };

// ---------------------------------------------------------------------------
// 社交链接 DOM 构建
// ---------------------------------------------------------------------------

export function createSocialLinkRow(
    socialLinksList: HTMLElement | null,
    platform = "",
    linkUrl = "",
    enabled = false,
): HTMLElement {
    const row = document.createElement("div");
    row.className = "flex flex-wrap items-center gap-2";
    row.draggable = true;

    const dragHandle = document.createElement("span");
    dragHandle.className =
        "cursor-grab active:cursor-grabbing text-30 hover:text-60 transition-colors select-none text-base leading-none";
    dragHandle.textContent = "≡";
    dragHandle.title = t(I18nKey.meSettingsDragSort);
    row.appendChild(dragHandle);

    const toggleWrap = document.createElement("label");
    toggleWrap.className =
        "flex items-center gap-1.5 text-sm text-60 cursor-pointer select-none";
    const checkInput = document.createElement("input");
    checkInput.type = "checkbox";
    checkInput.checked = enabled;
    checkInput.dataset.socialField = "enabled";
    checkInput.className = "toggle-checkbox";
    const track = document.createElement("span");
    track.className = "toggle-track";
    const knob = document.createElement("span");
    knob.className = "toggle-knob";
    track.appendChild(knob);
    toggleWrap.appendChild(checkInput);
    toggleWrap.appendChild(track);
    row.appendChild(toggleWrap);

    const select = document.createElement("select");
    select.className =
        "rounded-lg border border-(--line-divider) px-3 py-2 text-sm text-75 bg-transparent";
    select.dataset.socialField = "platform";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = t(I18nKey.meSettingsSocialSelectPlatform);
    select.appendChild(defaultOption);
    for (const p of SOCIAL_PLATFORMS) {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = SOCIAL_PLATFORM_LABELS[p] ?? p;
        if (p === platform) {
            opt.selected = true;
        }
        select.appendChild(opt);
    }
    row.appendChild(select);

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.placeholder = t(I18nKey.meSettingsSocialLinkUrl);
    urlInput.value = linkUrl;
    urlInput.className =
        "flex-1 min-w-[120px] rounded-lg border border-(--line-divider) px-3 py-2 text-sm text-75 bg-transparent placeholder:text-50";
    urlInput.dataset.socialField = "url";
    row.appendChild(urlInput);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = t(I18nKey.interactionCommonDelete);
    removeBtn.className =
        "px-3 py-1.5 rounded-lg border border-(--line-divider) text-sm text-75 hover:text-red-500 hover:border-red-300 transition-colors";
    removeBtn.addEventListener("click", () => {
        row.remove();
    });
    row.appendChild(removeBtn);

    const syncToggleState = (): void => {
        const canEnable =
            select.value.trim() !== "" && urlInput.value.trim() !== "";
        if (!canEnable && checkInput.checked) {
            checkInput.checked = false;
        }
        toggleWrap.classList.toggle("opacity-40", !canEnable);
        toggleWrap.classList.toggle("pointer-events-none", !canEnable);
    };
    select.addEventListener("change", syncToggleState);
    urlInput.addEventListener("input", syncToggleState);
    syncToggleState();

    attachSocialRowDragHandlers(row, socialLinksList);

    return row;
}

function attachSocialRowDragHandlers(
    row: HTMLElement,
    socialLinksList: HTMLElement | null,
): void {
    let socialDragSourceRef: HTMLElement | null = null;

    row.addEventListener("dragstart", (e) => {
        row.classList.add("opacity-40");
        e.dataTransfer?.setData("text/plain", "");
        socialDragSourceRef = row;
    });
    row.addEventListener("dragend", () => {
        row.classList.remove("opacity-40");
        socialDragSourceRef = null;
        socialLinksList
            ?.querySelectorAll(":scope > div")
            .forEach((el) => ((el as HTMLElement).style.borderTop = ""));
    });
    row.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (socialDragSourceRef && socialDragSourceRef !== row) {
            row.style.borderTop = "2px solid var(--primary)";
        }
    });
    row.addEventListener("dragleave", () => {
        row.style.borderTop = "";
    });
    row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.style.borderTop = "";
        if (
            !socialDragSourceRef ||
            socialDragSourceRef === row ||
            !socialLinksList
        ) {
            return;
        }
        const rows = [...socialLinksList.children];
        const fromIdx = rows.indexOf(socialDragSourceRef);
        const toIdx = rows.indexOf(row);
        if (fromIdx < toIdx) {
            row.after(socialDragSourceRef);
        } else {
            row.before(socialDragSourceRef);
        }
    });
}

export function createSocialAddDivider(
    socialLinksList: HTMLElement | null,
): HTMLElement {
    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.className =
        "flex items-center gap-2 w-full py-1.5 group/add cursor-pointer";
    const lineL = document.createElement("span");
    lineL.className =
        "flex-1 border-t border-dashed border-(--line-divider) group-hover/add:border-(--primary) transition-colors";
    const label = document.createElement("span");
    label.className =
        "px-4 py-1.5 rounded-lg border border-(--line-divider) text-sm text-60 group-hover/add:border-(--primary) group-hover/add:text-(--primary) transition-colors whitespace-nowrap select-none";
    label.textContent = t(I18nKey.meSettingsSocialAddLink);
    const lineR = document.createElement("span");
    lineR.className =
        "flex-1 border-t border-dashed border-(--line-divider) group-hover/add:border-(--primary) transition-colors";
    wrap.appendChild(lineL);
    wrap.appendChild(label);
    wrap.appendChild(lineR);
    wrap.addEventListener("click", () => {
        if (!socialLinksList) {
            return;
        }
        const rows = socialLinksList.querySelectorAll(":scope > div");
        for (const r of rows) {
            const p = (
                r.querySelector(
                    '[data-social-field="platform"]',
                ) as HTMLSelectElement | null
            )?.value;
            const u = (
                r.querySelector(
                    '[data-social-field="url"]',
                ) as HTMLInputElement | null
            )?.value;
            if (!p && !u) {
                (
                    r.querySelector(
                        '[data-social-field="platform"]',
                    ) as HTMLElement | null
                )?.focus();
                return;
            }
        }
        const newRow = createSocialLinkRow(socialLinksList);
        socialLinksList.insertBefore(newRow, wrap);
        (
            newRow.querySelector(
                '[data-social-field="platform"]',
            ) as HTMLElement | null
        )?.focus();
    });
    return wrap;
}

export function fillSocialLinks(
    socialLinksList: HTMLElement | null,
    links: SocialLink[] | null,
): void {
    if (!socialLinksList) {
        return;
    }
    socialLinksList.innerHTML = "";
    if (links && links.length > 0) {
        for (const link of links) {
            socialLinksList.appendChild(
                createSocialLinkRow(
                    socialLinksList,
                    link.platform,
                    link.url,
                    link.enabled,
                ),
            );
        }
    }
    socialLinksList.appendChild(createSocialAddDivider(socialLinksList));
}

export function collectSocialLinks(
    socialLinksList: HTMLElement | null,
): SocialLink[] {
    if (!socialLinksList) {
        return [];
    }
    const rows = socialLinksList.querySelectorAll(":scope > div");
    const result: SocialLink[] = [];
    for (const row of rows) {
        const platformEl = row.querySelector(
            '[data-social-field="platform"]',
        ) as HTMLSelectElement | null;
        const urlEl = row.querySelector(
            '[data-social-field="url"]',
        ) as HTMLInputElement | null;
        const enabledEl = row.querySelector(
            '[data-social-field="enabled"]',
        ) as HTMLInputElement | null;
        const platform = platformEl?.value?.trim() ?? "";
        const url = urlEl?.value?.trim() ?? "";
        if (platform && url) {
            result.push({
                platform,
                url,
                enabled: enabledEl?.checked ?? true,
            });
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// 社交链接保存按钮绑定
// ---------------------------------------------------------------------------

export function bindSocialSaveBtn(dom: MePageDom): void {
    if (!dom.socialSaveBtn || dom.socialSaveBtn.hasAttribute("data-me-bound")) {
        return;
    }
    dom.socialSaveBtn.setAttribute("data-me-bound", "");
    dom.socialSaveBtn.addEventListener("click", () => {
        void handleSocialSave(dom);
    });
}

import I18nKeyForSocial from "@/i18n/i18nKey";
import { runWithTask } from "@/scripts/progress-overlay-manager";
import {
    getApiErrorMessage,
    requestApi as socialApi,
} from "@/scripts/http-client";

async function handleSocialSave(dom: MePageDom): Promise<void> {
    const links = collectSocialLinks(dom.socialLinksList);
    const setSocialMsg = (msg: string): void => {
        if (dom.socialMsg) {
            dom.socialMsg.textContent = msg;
        }
    };
    setSocialMsg(t(I18nKeyForSocial.interactionCommonSaving));
    await runWithTask(
        {
            title: t(I18nKeyForSocial.meSettingsSavingSocialTitle),
            mode: "indeterminate",
            text: t(I18nKeyForSocial.interactionCommonSaving),
        },
        async ({ update }) => {
            try {
                const { response, data } = await socialApi(
                    "/api/v1/me/profile",
                    {
                        method: "PATCH",
                        body: JSON.stringify({ social_links: links }),
                    },
                );
                if (!response.ok || !data?.ok) {
                    setSocialMsg(
                        getApiErrorMessage(
                            data,
                            t(I18nKeyForSocial.interactionCommonSaveFailed),
                        ),
                    );
                    return;
                }
                update({
                    text: t(
                        I18nKeyForSocial.interactionCommonSaveCompletedReloading,
                    ),
                });
                setSocialMsg(
                    t(I18nKeyForSocial.interactionCommonSavedReloading),
                );
                window.setTimeout(() => {
                    window.location.reload();
                }, 120);
            } catch {
                setSocialMsg(
                    t(I18nKeyForSocial.interactionCommonSaveFailedRetry),
                );
            }
        },
    );
}
