/**
 * /admin/settings/site 页面运行逻辑。
 *
 * 从原始 `<script is:inline>` 抽离，确保页面切换后可正确重新初始化，
 * 不依赖整页刷新。
 *
 * 工具函数、编辑器构建逻辑、bindSettings 各分区均已移至
 * site-settings-page-helpers.ts，以保持文件行数在限制内。
 * Crop Modal 相关逻辑已移至 site-settings-page-crop.ts。
 */

import I18nKey from "@/i18n/i18nKey";
import { runWithTask } from "@/scripts/progress-overlay-manager";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";
import { t } from "@/scripts/i18n-runtime";
import { el, setMsg } from "@/scripts/dom-helpers";
import {
    DATA_BOUND,
    pendingCropBlobs,
    faviconListContainer,
    bannerDesktopListContainer,
    bannerDesktopDragSource,
    setFaviconListContainer,
    setBannerDesktopListContainer,
    setOnFaviconRemoved,
    setOnBannerRemoved,
    createFaviconRow,
    uploadPendingCropImages,
} from "@/scripts/site-settings-page-editor";
import { setNavLinksContainer } from "@/scripts/site-settings-page-nav";
import {
    bindSettings,
    collectSitePayload,
    collectNavPayload,
    collectHomePayload,
    collectOtherPayload,
    collectFeaturePayload,
} from "@/scripts/site-settings-page-helpers";
import type { SettingsObj } from "@/scripts/site-settings-page-helpers";
import { buildCropTargets } from "@/scripts/site-settings-page-crop";
import type {
    CropState,
    CropModalContext,
} from "@/scripts/site-settings-page-crop";
import {
    bindCropButtonEvents,
    bindCropViewportEvents,
    bindCropUploadButton,
} from "@/scripts/site-settings-page-crop-actions";

// ---------------------------------------------------------------------------
// saveSection（从 initSiteSettingsPage 提取）
// ---------------------------------------------------------------------------

async function saveSection(
    msgId: string,
    collectFn: (current: SettingsObj) => SettingsObj,
    getCurrentSettings: () => SettingsObj | null,
    setCurrentSettings: (s: SettingsObj) => void,
    reloadBindSettings: (s: SettingsObj) => void,
): Promise<void> {
    const currentSettings = getCurrentSettings();
    if (!currentSettings) {
        return;
    }
    const settingsSnapshot = currentSettings;
    const pendingCount = pendingCropBlobs.size;
    const totalSteps = pendingCount + 1;
    setMsg(msgId, t(I18nKey.interactionCommonSaving));
    await runWithTask(
        {
            title: t(I18nKey.adminSiteSettingsSavingTitle),
            mode: pendingCount > 0 ? "determinate" : "indeterminate",
            percent: 0,
            text:
                pendingCount > 0
                    ? t(I18nKey.interactionCommonImageUploading)
                    : t(I18nKey.interactionCommonSaving),
        },
        async ({ update }) => {
            try {
                const uploadOk = await uploadPendingCropImages(
                    msgId,
                    pendingCount,
                    totalSteps,
                    update,
                );
                if (!uploadOk) {
                    return;
                }

                update({
                    mode: pendingCount > 0 ? "determinate" : "indeterminate",
                    text: t(I18nKey.adminSiteSettingsSavingConfig),
                    percent:
                        pendingCount > 0
                            ? Math.round((pendingCount / totalSteps) * 100)
                            : undefined,
                });
                const sectionPayload = collectFn(settingsSnapshot);
                const payload: SettingsObj = {
                    ...settingsSnapshot,
                    ...sectionPayload,
                };
                const { response, data } = await api(
                    "/api/v1/admin/settings/site",
                    {
                        method: "PATCH",
                        body: JSON.stringify(payload),
                    },
                );
                if (!response.ok || !data?.ok) {
                    setMsg(
                        msgId,
                        getApiErrorMessage(
                            data,
                            t(I18nKey.interactionCommonSaveFailed),
                        ),
                    );
                    return;
                }
                update({
                    mode: pendingCount > 0 ? "determinate" : "indeterminate",
                    text: t(I18nKey.interactionCommonSaveCompletedReloading),
                    percent: pendingCount > 0 ? 100 : undefined,
                });
                const newSettings = (data.settings ?? payload) as SettingsObj;
                setCurrentSettings(newSettings);
                reloadBindSettings(newSettings);
                setMsg(msgId, t(I18nKey.interactionCommonSavedReloading));
                window.setTimeout(() => {
                    window.location.reload();
                }, 120);
            } catch (err) {
                setMsg(
                    msgId,
                    err instanceof Error
                        ? err.message
                        : t(I18nKey.adminSiteSettingsInvalidInput),
                );
            }
        },
    );
}

// ---------------------------------------------------------------------------
// setupCropModal：组装 CropModalContext 并绑定所有事件
// ---------------------------------------------------------------------------

function setupCropModal(
    state: CropState,
    cropViewport: HTMLElement,
    cropImage: HTMLImageElement,
    cropModal: HTMLElement,
    cropPanel: HTMLElement | null,
    cropTitle: HTMLElement | null,
    cropHelp: HTMLElement | null,
    cropEmpty: HTMLElement | null,
    cropFileInput: HTMLInputElement | null,
    cropSelectBtn: HTMLButtonElement | null,
    cropApplyBtn: HTMLButtonElement | null,
    cropCancelBtn: HTMLButtonElement | null,
    cropZoomInput: HTMLInputElement | null,
    cropMsg: HTMLElement | null,
): void {
    const cropTargets = buildCropTargets(
        faviconListContainer,
        bannerDesktopListContainer,
        () => bannerDesktopDragSource,
        (newEl) => {
            void newEl;
        },
    );

    const ctx: CropModalContext = {
        state,
        cropTargets,
        cropViewport,
        cropImage,
        cropModal,
        cropPanel,
        cropTitle,
        cropHelp,
        cropEmpty,
        cropFileInput,
        cropApplyBtn,
        cropZoomInput,
        cropMsg,
    };

    bindCropButtonEvents(ctx, cropSelectBtn, cropCancelBtn);
    bindCropViewportEvents(ctx);
    bindCropUploadButton(ctx, "ss-favicon-upload-btn", "favicon");
    bindCropUploadButton(ctx, "ss-banner-desktop-upload-btn", "banner-desktop");
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

export function initSiteSettingsPage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/admin/settings/site") {
        return;
    }

    const root = el("ss-authenticated");
    if (!root || root.hasAttribute(DATA_BOUND)) {
        return;
    }
    root.setAttribute(DATA_BOUND, "1");

    // 获取可视化编辑器容器引用
    setNavLinksContainer(el("ss-nav-links-list"));
    setFaviconListContainer(el("ss-favicon-list"));
    setBannerDesktopListContainer(el("ss-banner-desktop-list"));

    const cropModal = el("ss-image-crop-modal");
    const cropViewport = el("ss-image-crop-viewport") as HTMLElement | null;
    const cropImage = el("ss-image-crop-image") as HTMLImageElement | null;

    if (!cropModal || !cropViewport || !cropImage) {
        return;
    }

    const cropState: CropState = {
        activeCropTarget: null,
        cropUploading: false,
        cropObjectUrl: "",
        cropLoaded: false,
        cropImageWidth: 0,
        cropImageHeight: 0,
        cropViewportWidth: 0,
        cropViewportHeight: 0,
        cropMinScale: 1,
        cropScale: 1,
        cropOffsetX: 0,
        cropOffsetY: 0,
        cropPointerId: null,
        cropPointerX: 0,
        cropPointerY: 0,
        cropResizeHandlerBound: false,
    };

    setupCropModal(
        cropState,
        cropViewport,
        cropImage,
        cropModal,
        el("ss-image-crop-panel"),
        el("ss-image-crop-title"),
        el("ss-image-crop-help"),
        el("ss-image-crop-empty"),
        el("ss-image-crop-file") as HTMLInputElement | null,
        el("ss-image-crop-select-btn") as HTMLButtonElement | null,
        el("ss-image-crop-apply-btn") as HTMLButtonElement | null,
        el("ss-image-crop-cancel-btn") as HTMLButtonElement | null,
        el("ss-image-crop-zoom") as HTMLInputElement | null,
        el("ss-image-crop-msg"),
    );

    let currentSettings: SettingsObj | null = null;

    // ---- load from API ----
    const loadSettings = async (): Promise<void> => {
        const { response, data } = await api("/api/v1/admin/settings/site");
        if (!response.ok || !data?.ok) {
            return;
        }
        currentSettings = (data.settings ?? {}) as SettingsObj;
        bindSettings(currentSettings);
    };

    // ---- onRemoved callbacks ----
    setOnFaviconRemoved(() => {
        if (!currentSettings) {
            return;
        }
        currentSettings = {
            ...currentSettings,
            ...collectSitePayload(currentSettings),
        };
        setMsg(
            "ss-site-msg",
            t(I18nKey.adminSiteSettingsIconRemovedPendingSave),
        );
    });

    setOnBannerRemoved(() => {
        if (!currentSettings) {
            return;
        }
        currentSettings = {
            ...currentSettings,
            ...collectHomePayload(currentSettings),
        };
        setMsg(
            "ss-home-msg",
            t(I18nKey.adminSiteSettingsBannerRemovedPendingSave),
        );
    });

    // ---- form submit handlers ----
    const bindForm = (
        formId: string,
        msgId: string,
        collectFn: (current: SettingsObj) => SettingsObj,
    ): void => {
        const form = el(formId);
        if (!form || form.hasAttribute(DATA_BOUND)) {
            return;
        }
        form.setAttribute(DATA_BOUND, "1");
        form.addEventListener("submit", (event: Event) => {
            event.preventDefault();
            void saveSection(
                msgId,
                collectFn,
                () => currentSettings,
                (s) => {
                    currentSettings = s;
                },
                bindSettings,
            );
        });
    };

    bindForm("ss-site-form", "ss-site-msg", collectSitePayload);
    bindForm("ss-nav-form", "ss-nav-msg", collectNavPayload);
    bindForm("ss-home-form", "ss-home-msg", collectHomePayload);
    bindForm("ss-feature-form", "ss-feature-msg", collectFeaturePayload);
    bindForm("ss-other-form", "ss-other-msg", collectOtherPayload);

    // ---- favicon add button ----
    const faviconAddButton = el(
        "ss-favicon-add-btn",
    ) as HTMLButtonElement | null;
    if (faviconAddButton && !faviconAddButton.hasAttribute(DATA_BOUND)) {
        faviconAddButton.setAttribute(DATA_BOUND, "1");
        faviconAddButton.addEventListener("click", () => {
            if (!faviconListContainer) {
                return;
            }
            faviconListContainer.appendChild(createFaviconRow({ src: "" }));
            setMsg(
                "ss-site-msg",
                t(I18nKey.adminSiteSettingsIconAddedPendingSave),
            );
        });
    }

    // ---- kick off ----
    loadSettings().catch((err) => {
        console.error("[site-settings-page] init failed", err);
    });
}
