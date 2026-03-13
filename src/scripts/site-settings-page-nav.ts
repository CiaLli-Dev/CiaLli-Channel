/**
 * site-settings-page 的导航链接编辑器模块。
 *
 * 包含导航链接类型定义、预设链接配置、导航行创建与收集函数。
 */

import I18nKey from "@/i18n/i18nKey";
import { t, tFmt } from "@/scripts/i18n-runtime";
import {
    INPUT_CLS,
    BTN_DELETE_CLS,
    DRAG_HANDLE_CLS,
    DATA_BOUND,
    attachDragEvents,
} from "@/scripts/site-settings-page-editor";

// ---------------------------------------------------------------------------
// 导航链接类型
// ---------------------------------------------------------------------------

export type NavLinkItem = number | NavBarLinkObj;
export interface NavBarLinkObj {
    name: string;
    url: string;
    external?: boolean;
    icon?: string;
    children?: NavLinkItem[];
}

export const PRESET_TO_LINK: Record<number, NavBarLinkObj> = {
    0: { name: t(I18nKey.coreHome), url: "/", icon: "material-symbols:home" },
    1: {
        name: t(I18nKey.coreArchive),
        url: "/posts",
        icon: "material-symbols:archive",
    },
    2: {
        name: t(I18nKey.coreAbout),
        url: "/about",
        icon: "material-symbols:person",
    },
    3: {
        name: t(I18nKey.contentFriends),
        url: "/friends",
        icon: "material-symbols:group",
    },
    4: {
        name: t(I18nKey.contentAnime),
        url: "/me/#bangumi",
        icon: "material-symbols:movie",
    },
    5: {
        name: t(I18nKey.contentDiary),
        url: "/me/#diary",
        icon: "material-symbols:book",
    },
    6: {
        name: t(I18nKey.contentAlbums),
        url: "/me/#albums",
        icon: "material-symbols:photo-library",
    },
};

export const expandPreset = (item: NavLinkItem): NavBarLinkObj => {
    if (typeof item === "number") {
        return {
            ...(PRESET_TO_LINK[item] ?? {
                name: tFmt(I18nKey.adminSiteSettingsPresetLink, {
                    index: item,
                }),
                url: "/",
            }),
        };
    }
    return item;
};

// ---------------------------------------------------------------------------
// 导航链接编辑器
// ---------------------------------------------------------------------------

export let navDragSource: HTMLElement | null = null;
export let navChildDragSource: HTMLElement | null = null;
export let navLinksContainer: HTMLElement | null = null;

export const setNavLinksContainer = (c: HTMLElement | null): void => {
    navLinksContainer = c;
};

export const createNavLinkRow = (
    item: NavBarLinkObj,
    isChild: boolean,
    container: HTMLElement,
): HTMLElement => {
    const row = document.createElement("div");
    row.className = `flex flex-wrap items-center gap-2 ${isChild ? "ml-8" : ""}`;

    const dragHandle = document.createElement("span");
    dragHandle.className = DRAG_HANDLE_CLS;
    dragHandle.textContent = "≡";
    dragHandle.title = t(I18nKey.meSettingsDragSort);
    row.appendChild(dragHandle);

    appendNavInputs(row, item);
    appendNavExternalToggle(row, item);

    if (!isChild) {
        appendNavChildToggle(row);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = t(I18nKey.interactionCommonDelete);
    removeBtn.className = BTN_DELETE_CLS;
    removeBtn.addEventListener("click", () => {
        const nextSibling = row.nextElementSibling;
        if (nextSibling && nextSibling.classList.contains("nav-child-block")) {
            nextSibling.remove();
        }
        row.remove();
    });
    row.appendChild(removeBtn);

    if (isChild) {
        attachDragEvents(
            row,
            () => navChildDragSource,
            (e) => {
                navChildDragSource = e;
            },
            container,
        );
    } else {
        attachDragEvents(
            row,
            () => navDragSource,
            (e) => {
                navDragSource = e;
            },
            container,
        );
    }

    return row;
};

function appendNavInputs(row: HTMLElement, item: NavBarLinkObj): void {
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = t(I18nKey.adminSiteSettingsNavNamePlaceholder);
    nameInput.value = item.name ?? "";
    nameInput.className = `${INPUT_CLS} w-24`;
    nameInput.dataset.navField = "name";
    row.appendChild(nameInput);

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.placeholder = "URL";
    urlInput.value = item.url ?? "";
    urlInput.className = `${INPUT_CLS} flex-1 min-w-[120px]`;
    urlInput.dataset.navField = "url";
    row.appendChild(urlInput);

    const iconInput = document.createElement("input");
    iconInput.type = "text";
    iconInput.placeholder = t(I18nKey.adminSiteSettingsNavIconPlaceholder);
    iconInput.value = item.icon ?? "";
    iconInput.className = `${INPUT_CLS} w-36`;
    iconInput.dataset.navField = "icon";
    row.appendChild(iconInput);
}

function appendNavExternalToggle(row: HTMLElement, item: NavBarLinkObj): void {
    const extLabel = document.createElement("label");
    extLabel.className =
        "flex items-center gap-2 text-xs text-60 cursor-pointer select-none";
    const extCheck = document.createElement("input");
    extCheck.type = "checkbox";
    extCheck.className = "toggle-checkbox";
    extCheck.checked = item.external ?? false;
    extCheck.dataset.navField = "external";
    const track = document.createElement("span");
    track.className = "toggle-track";
    const knob = document.createElement("span");
    knob.className = "toggle-knob";
    track.appendChild(knob);
    extLabel.appendChild(extCheck);
    extLabel.appendChild(track);
    extLabel.appendChild(
        document.createTextNode(t(I18nKey.adminSiteSettingsExternalLink)),
    );
    row.appendChild(extLabel);
}

function appendNavChildToggle(row: HTMLElement): void {
    const childToggle = document.createElement("button");
    childToggle.type = "button";
    childToggle.className =
        "nav-child-toggle px-2 py-1.5 rounded-lg border border-(--line-divider) text-xs text-75 hover:border-(--primary) hover:text-(--primary) transition-colors";
    childToggle.textContent = t(I18nKey.adminSiteSettingsAddSubmenu);
    childToggle.title = t(I18nKey.adminSiteSettingsAddSubmenu);
    childToggle.addEventListener("click", () => {
        const block = createNavChildrenBlock([]);
        row.after(block);
        childToggle.classList.add("hidden");
    });
    row.appendChild(childToggle);
}

export const createNavChildrenBlock = (
    children: NavLinkItem[],
): HTMLElement => {
    const block = document.createElement("div");
    block.className =
        "nav-child-block space-y-2 ml-4 pl-4 border-l-2 border-(--line-divider)";

    for (const child of children) {
        block.appendChild(createNavLinkRow(expandPreset(child), true, block));
    }

    block.appendChild(
        createAddDivider(t(I18nKey.adminSiteSettingsAddChildLink), () => {
            const newRow = createNavLinkRow({ name: "", url: "" }, true, block);
            const divider = block.querySelector(
                ":scope > button",
            ) as HTMLElement | null;
            if (divider) {
                block.insertBefore(newRow, divider);
            } else {
                block.appendChild(newRow);
            }
        }),
    );

    return block;
};

export const fillNavLinks = (
    links: NavLinkItem[],
    container: HTMLElement,
): void => {
    container.innerHTML = "";

    for (const item of links) {
        const expanded = expandPreset(item);
        const row = createNavLinkRow(expanded, false, container);
        container.appendChild(row);

        if (expanded.children && expanded.children.length > 0) {
            container.appendChild(createNavChildrenBlock(expanded.children));
            const toggle = row.querySelector(".nav-child-toggle");
            if (toggle) {
                toggle.classList.add("hidden");
            }
        }
    }

    container.appendChild(
        createAddDivider(t(I18nKey.adminSiteSettingsAddNavLink), () => {
            const newRow = createNavLinkRow(
                { name: "", url: "" },
                false,
                container,
            );
            const divider = container.querySelector(
                ":scope > button",
            ) as HTMLElement | null;
            if (divider) {
                container.insertBefore(newRow, divider);
            } else {
                container.appendChild(newRow);
            }
        }),
    );
};

export const collectLinkFromRow = (row: HTMLElement): NavBarLinkObj | null => {
    const name =
        (
            row.querySelector(
                '[data-nav-field="name"]',
            ) as HTMLInputElement | null
        )?.value?.trim() ?? "";
    const url =
        (
            row.querySelector(
                '[data-nav-field="url"]',
            ) as HTMLInputElement | null
        )?.value?.trim() ?? "";
    const icon =
        (
            row.querySelector(
                '[data-nav-field="icon"]',
            ) as HTMLInputElement | null
        )?.value?.trim() ?? "";
    const external = (
        row.querySelector(
            '[data-nav-field="external"]',
        ) as HTMLInputElement | null
    )?.checked;

    if (!name && !url) {
        return null;
    }

    const linkObj: NavBarLinkObj = { name, url };
    if (icon) {
        linkObj.icon = icon;
    }
    if (external) {
        linkObj.external = true;
    }
    return linkObj;
};

export const collectNavLinks = (container: HTMLElement): NavBarLinkObj[] => {
    const result: NavBarLinkObj[] = [];
    const topChildren = [...container.children];

    for (let i = 0; i < topChildren.length; i++) {
        const child = topChildren[i] as HTMLElement;

        if (child.tagName === "BUTTON") {
            continue;
        }
        if (child.classList.contains("nav-child-block")) {
            continue;
        }

        const linkObj = collectLinkFromRow(child);
        if (!linkObj) {
            continue;
        }

        const nextSibling = topChildren[i + 1] as HTMLElement | undefined;
        if (nextSibling?.classList.contains("nav-child-block")) {
            const childLinks = collectChildLinks(nextSibling);
            if (childLinks.length > 0) {
                linkObj.children = childLinks;
            }
        }

        result.push(linkObj);
    }

    return result;
};

export const collectChildLinks = (block: HTMLElement): NavBarLinkObj[] => {
    const result: NavBarLinkObj[] = [];
    for (const child of block.children) {
        const row = child as HTMLElement;
        if (row.tagName === "BUTTON") {
            continue;
        }
        const linkObj = collectLinkFromRow(row);
        if (linkObj) {
            result.push(linkObj);
        }
    }
    return result;
};

// ---------------------------------------------------------------------------
// 分隔线创建工具（被此模块和 editor 模块共用）
// ---------------------------------------------------------------------------

export const createAddDivider = (
    label: string,
    onClick: () => void,
): HTMLElement => {
    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.className =
        "flex items-center gap-2 w-full py-1.5 group/add cursor-pointer";
    const lineL = document.createElement("span");
    lineL.className =
        "flex-1 border-t border-dashed border-(--line-divider) group-hover/add:border-(--primary) transition-colors";
    const labelEl = document.createElement("span");
    labelEl.className =
        "px-4 py-1.5 rounded-lg border border-(--line-divider) text-sm text-60 group-hover/add:border-(--primary) group-hover/add:text-(--primary) transition-colors whitespace-nowrap select-none";
    labelEl.textContent = label;
    const lineR = document.createElement("span");
    lineR.className =
        "flex-1 border-t border-dashed border-(--line-divider) group-hover/add:border-(--primary) transition-colors";
    wrap.appendChild(lineL);
    wrap.appendChild(labelEl);
    wrap.appendChild(lineR);
    wrap.addEventListener("click", onClick);
    return wrap;
};

// 为向后兼容，导出 DATA_BOUND
export { DATA_BOUND };
