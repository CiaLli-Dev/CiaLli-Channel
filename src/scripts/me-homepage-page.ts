/**
 * /me/homepage 编辑页面逻辑 — 头图上传 + 模块排序
 */

import { buildLoginRedirectHref, extractFileId } from "@/scripts/dom-helpers";
import { requestApi as api } from "@/scripts/http-client";
import {
    type PageDomRefs,
    type PageState,
    type TaskHandles,
    loadAuthMe,
} from "@/scripts/me-homepage-page-helpers";
import {
    fillBangumiConfig,
    fillSectionList,
    initCropState,
    setupBangumiEvents,
    setupCropEvents,
    setupHeaderEvents,
    setupSectionEvents,
} from "@/scripts/me-homepage-page-setup";

// ---------------------------------------------------------------------------
// DOM 引用收集
// ---------------------------------------------------------------------------

function collectDomRefs(): PageDomRefs | null {
    const editorSections = document.getElementById("homepage-editor-sections");
    if (!editorSections) return null;
    return {
        editorSections,
        headerPreview: document.getElementById(
            "homepage-header-preview",
        ) as HTMLImageElement | null,
        headerEmpty: document.getElementById("homepage-header-empty"),
        headerPreviewArea: document.getElementById(
            "homepage-header-preview-area",
        ),
        headerChangeBtn: document.getElementById("homepage-header-change-btn"),
        headerRemoveBtn: document.getElementById("homepage-header-remove-btn"),
        headerSaveBtn: document.getElementById("homepage-header-save-btn"),
        headerMsg: document.getElementById("homepage-header-msg"),
        sectionOrderList: document.getElementById(
            "homepage-section-order-list",
        ),
        sectionResetBtn: document.getElementById("homepage-section-reset-btn"),
        sectionSaveBtn: document.getElementById("homepage-section-save-btn"),
        sectionMsg: document.getElementById("homepage-section-msg"),
        bangumiForm: document.getElementById(
            "homepage-bangumi-form",
        ) as HTMLFormElement | null,
        bangumiShowInput: document.getElementById(
            "homepage-bangumi-show",
        ) as HTMLInputElement | null,
        bangumiPrivateInput: document.getElementById(
            "homepage-bangumi-private",
        ) as HTMLInputElement | null,
        bangumiUsernameInput: document.getElementById(
            "homepage-bangumi-username",
        ) as HTMLInputElement | null,
        bangumiTokenInput: document.getElementById(
            "homepage-bangumi-token",
        ) as HTMLInputElement | null,
        bangumiTokenState: document.getElementById(
            "homepage-bangumi-token-state",
        ),
        bangumiClearTokenBtn: document.getElementById(
            "homepage-bangumi-clear-token-btn",
        ) as HTMLButtonElement | null,
        bangumiMsg: document.getElementById("homepage-bangumi-msg"),
        cropModal: document.getElementById("homepage-header-crop-modal"),
        cropViewport: document.getElementById("homepage-header-crop-viewport"),
        cropImage: document.getElementById(
            "homepage-header-crop-image",
        ) as HTMLImageElement | null,
        cropEmpty: document.getElementById("homepage-header-crop-empty"),
        cropFileInput: document.getElementById(
            "homepage-header-crop-file",
        ) as HTMLInputElement | null,
        cropSelectBtn: document.getElementById(
            "homepage-header-crop-select-btn",
        ),
        cropApplyBtn: document.getElementById(
            "homepage-header-crop-apply-btn",
        ) as HTMLButtonElement | null,
        cropCancelBtn: document.getElementById(
            "homepage-header-crop-cancel-btn",
        ),
        cropZoomInput: document.getElementById(
            "homepage-header-crop-zoom",
        ) as HTMLInputElement | null,
        cropMsgEl: document.getElementById("homepage-header-crop-msg"),
    };
}

// ---------------------------------------------------------------------------
// 初始化状态
// ---------------------------------------------------------------------------

function createInitialState(): PageState {
    return {
        currentHeaderFileId: "",
        currentLoginEmail: "",
        pendingHeaderUpload: null,
        headerRemoved: false,
        bangumiTokenSet: false,
        bangumiTokenClearRequested: false,
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
        cropUploading: false,
        sectionDragSource: null,
    };
}

// ---------------------------------------------------------------------------
// 页面初始化
// ---------------------------------------------------------------------------

async function runInit(refs: PageDomRefs, state: PageState): Promise<void> {
    refs.editorSections.classList.add("hidden");

    const me = await loadAuthMe();
    if (!me.response.ok || !me.data?.ok) {
        window.location.href = buildLoginRedirectHref();
        return;
    }
    state.currentLoginEmail = String(
        (me.data.user as Record<string, unknown> | undefined)?.email || "",
    ).trim();

    const profileResp = await api("/api/v1/me/profile");
    if (profileResp.response.ok && profileResp.data?.ok) {
        const profile = profileResp.data.profile as
            | Record<string, unknown>
            | undefined;
        state.currentHeaderFileId = extractFileId(profile?.header_file);
        state.headerRemoved = false;
        initCropState(refs, state);

        const order = Array.isArray(profile?.home_section_order)
            ? (profile.home_section_order as string[])
            : null;
        fillSectionList(refs, state, order);
        fillBangumiConfig(profile, refs, state);
    } else {
        fillSectionList(refs, state, null);
        fillBangumiConfig(undefined, refs, state);
    }

    refs.editorSections.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function initMeHomepagePage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/me/homepage") return;

    const refs = collectDomRefs();
    if (!refs) return;

    const state = createInitialState();
    const handles: TaskHandles = { headerSaveTaskHandle: null };

    setupHeaderEvents(refs, state, handles);
    setupCropEvents(refs, state);
    setupSectionEvents(refs, state);
    setupBangumiEvents(refs, state);

    initCropState(refs, state);

    runInit(refs, state).catch((err: unknown) => {
        console.error("[me-homepage-page] init failed", err);
    });
}
