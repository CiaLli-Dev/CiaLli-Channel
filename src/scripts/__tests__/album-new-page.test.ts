import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import I18nKey from "@/i18n/i18nKey";

const { getCsrfTokenMock, navigateMock } = vi.hoisted(() => ({
    getCsrfTokenMock: vi.fn(() => "csrf-token"),
    navigateMock: vi.fn(),
}));

vi.mock("@/utils/csrf", () => ({
    getCsrfToken: getCsrfTokenMock,
}));

vi.mock("astro:transitions/client", () => ({
    navigate: navigateMock,
}));

type AlbumNewTestWindow = Window &
    typeof globalThis & {
        __CIALLI_I18N__?: Record<string, string>;
        __albumNewCleanup?: () => void;
        __ASTRO_TRANSITIONS_NAVIGATE__?: (path: string) => void;
    };

function getTestWindow(): AlbumNewTestWindow {
    return window as AlbumNewTestWindow;
}

function setupAlbumNewDom(): void {
    document.body.innerHTML = `
        <form id="album-publish-form" data-username="Admin" novalidate>
            <input
                id="album-title"
                name="title"
                type="text"
                required
                aria-describedby="album-title-counter album-publish-error"
                aria-invalid="false"
            />
            <span id="album-title-counter"></span>
            <div id="album-publish-error" class="hidden" role="alert"></div>
            <button id="album-publish-btn" type="submit">创建相册</button>
        </form>
    `;
}

function getTitleInput(): HTMLInputElement {
    const titleInput = document.getElementById("album-title");
    if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("album-title input missing");
    }
    return titleInput;
}

function getForm(): HTMLFormElement {
    const form = document.getElementById("album-publish-form");
    if (!(form instanceof HTMLFormElement)) {
        throw new Error("album-publish-form missing");
    }
    return form;
}

function getErrorElement(): HTMLElement {
    const errorElement = document.getElementById("album-publish-error");
    if (!(errorElement instanceof HTMLElement)) {
        throw new Error("album-publish-error missing");
    }
    return errorElement;
}

async function initAlbumNewPage(): Promise<void> {
    const module = await import("@/scripts/albums/new-page");
    module.initAlbumNewPage();
}

async function submitAlbumForm(): Promise<void> {
    getForm().dispatchEvent(
        new SubmitEvent("submit", {
            bubbles: true,
            cancelable: true,
        }),
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe("initAlbumNewPage", () => {
    beforeEach(() => {
        vi.resetModules();
        setupAlbumNewDom();
        getTestWindow().__CIALLI_I18N__ = {
            [I18nKey.contentAlbumTitleRequired]: "请输入相册标题",
            [I18nKey.contentAlbumTitleTooLong]:
                "相册标题过长（最多 {max} 字符，中文算 2 字符）",
            [I18nKey.contentAlbumCreateSubmit]: "创建相册",
            [I18nKey.contentAlbumCreateTitle]: "新建相册",
            [I18nKey.interactionCommonCreateInProgress]: "创建中...",
            [I18nKey.interactionCommonSubmitting]: "提交中...",
            [I18nKey.interactionCommonProcessing]: "处理中...",
            [I18nKey.interactionPostActionFailed]: "操作失败",
        };
        getCsrfTokenMock.mockReturnValue("csrf-token");
        navigateMock.mockReset();
        getTestWindow().__ASTRO_TRANSITIONS_NAVIGATE__ = navigateMock;
    });

    afterEach(() => {
        getTestWindow().__albumNewCleanup?.();
        delete getTestWindow().__CIALLI_I18N__;
        delete getTestWindow().__ASTRO_TRANSITIONS_NAVIGATE__;
        vi.unstubAllGlobals();
    });

    it("空标题提交时显示明确错误并阻止请求", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await initAlbumNewPage();
        await submitAlbumForm();

        const titleInput = getTitleInput();
        const errorElement = getErrorElement();
        expect(errorElement.textContent).toBe("请输入相册标题");
        expect(errorElement.classList.contains("hidden")).toBe(false);
        expect(titleInput.getAttribute("aria-invalid")).toBe("true");
        expect(document.activeElement).toBe(titleInput);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("超长标题提交时显示本地化长度错误并阻止请求", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await initAlbumNewPage();
        getTitleInput().value = "abcdefghijklmnopqrstu";
        await submitAlbumForm();

        const errorElement = getErrorElement();
        expect(errorElement.textContent).toBe(
            "相册标题过长（最多 20 字符，中文算 2 字符）",
        );
        expect(getTitleInput().getAttribute("aria-invalid")).toBe("true");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("有效标题提交时创建草稿相册", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    item: {
                        id: "album-1",
                        short_id: "short-1",
                    },
                }),
                {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        await initAlbumNewPage();
        getTitleInput().value = "旅行";
        await submitAlbumForm();

        expect(fetchMock).toHaveBeenCalledWith("/api/v1/me/albums", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-csrf-token": "csrf-token",
            },
            body: JSON.stringify({
                title: "旅行",
                is_public: false,
            }),
        });
        expect(getTitleInput().getAttribute("aria-invalid")).toBe("false");
        expect(navigateMock).toHaveBeenCalledWith(
            "/Admin/albums/short-1?edit=1",
        );
    });
});
