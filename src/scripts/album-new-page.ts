import I18nKey from "@i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import { navigate } from "astro:transitions/client";

type AlbumNewRuntimeWindow = Window &
    typeof globalThis & {
        __albumNewCleanup?: () => void;
        __CIALLI_PROGRESS_OVERLAY__?: {
            startTask: (options: {
                delayMs?: number;
                title?: string;
                mode?: "indeterminate" | "determinate";
                text?: string;
            }) => number;
            updateTask: (
                handle: number,
                stage: {
                    text?: string;
                },
            ) => void;
            finishTask: (handle: number) => void;
        };
    };

type AlbumCreateResponse = {
    item?: {
        id?: string;
        short_id?: string | null;
    };
    error?: {
        message?: string;
    };
};

const ALBUM_TITLE_MAX = 20;
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;

function getCsrfToken(): string {
    const element = document.querySelector('meta[name="cialli-csrf-token"]');
    if (!(element instanceof HTMLMetaElement)) {
        return "";
    }
    return element.content || "";
}

function wordLength(value: string): number {
    let count = 0;
    for (const char of value) {
        count += CJK_RE.test(char) ? 2 : 1;
    }
    return count;
}

function resolveUsername(form: HTMLFormElement): string {
    const fromDataset = String(form.dataset.username || "").trim();
    if (fromDataset) {
        return fromDataset;
    }
    const matched = window.location.pathname.match(
        /^\/([^/]+)\/albums\/new\/?$/,
    );
    return matched?.[1] ? decodeURIComponent(matched[1]) : "";
}

export function initAlbumNewPage(): void {
    const runtimeWindow = window as AlbumNewRuntimeWindow;
    runtimeWindow.__albumNewCleanup?.();

    const form = document.getElementById(
        "album-publish-form",
    ) as HTMLFormElement | null;
    if (!form) {
        return;
    }

    const titleInput = document.getElementById(
        "album-title",
    ) as HTMLInputElement | null;
    const submitBtn = document.getElementById(
        "album-publish-btn",
    ) as HTMLButtonElement | null;
    const errorElement = document.getElementById("album-publish-error");
    const counterElement = document.getElementById("album-title-counter");
    const username = resolveUsername(form);
    const submitDefaultText =
        submitBtn?.textContent || t(I18nKey.contentAlbumCreateSubmit);

    const updateCounter = (): void => {
        if (!titleInput || !counterElement) {
            return;
        }
        const length = wordLength(titleInput.value);
        counterElement.textContent = `${length} / ${ALBUM_TITLE_MAX}`;
        counterElement.className = `text-xs mt-1 block ${length > ALBUM_TITLE_MAX ? "text-red-500" : "text-50"}`;
    };

    const showError = (message: string): void => {
        if (!errorElement) {
            return;
        }
        errorElement.textContent = message;
        errorElement.classList.remove("hidden");
    };

    const startOverlayTask = (options: {
        title?: string;
        mode?: "indeterminate" | "determinate";
        text?: string;
    }): number | null => {
        const overlay = runtimeWindow.__CIALLI_PROGRESS_OVERLAY__;
        if (!overlay) {
            return null;
        }
        return overlay.startTask({
            delayMs: 300,
            ...options,
        });
    };

    const updateOverlayTask = (
        handle: number | null,
        stage: {
            text?: string;
        },
    ): void => {
        if (typeof handle !== "number") {
            return;
        }
        runtimeWindow.__CIALLI_PROGRESS_OVERLAY__?.updateTask(handle, stage);
    };

    const finishOverlayTask = (handle: number | null): void => {
        if (typeof handle !== "number") {
            return;
        }
        runtimeWindow.__CIALLI_PROGRESS_OVERLAY__?.finishTask(handle);
    };

    const navigateInternal = (path: string): void => {
        try {
            navigate(path);
        } catch (error) {
            console.warn(
                "[album-new] Astro navigation failed, fallback to location.href:",
                error,
            );
            window.location.href = path;
        }
    };

    const abortController = new AbortController();
    const { signal } = abortController;

    titleInput?.addEventListener("input", updateCounter, { signal });

    const resetSubmitBtn = (): void => {
        submitBtn?.removeAttribute("disabled");
        if (submitBtn) {
            submitBtn.textContent = submitDefaultText;
        }
    };

    const validateTitle = (): string | null => {
        const title = titleInput?.value.trim() || "";
        if (!title) {
            showError(t(I18nKey.contentAlbumTitlePlaceholder));
            return null;
        }
        if (wordLength(title) > ALBUM_TITLE_MAX) {
            showError(`Title too long (max ${ALBUM_TITLE_MAX})`);
            return null;
        }
        return title;
    };

    const fetchCreateAlbum = async (
        title: string,
    ): Promise<{ response: Response; data: AlbumCreateResponse }> => {
        const response = await fetch("/api/v1/me/albums", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-csrf-token": getCsrfToken(),
            },
            body: JSON.stringify({ title, is_public: false }),
        });
        const data = (await response.json()) as AlbumCreateResponse;
        return { response, data };
    };

    const handleCreateSuccess = (
        overlayHandle: number | null,
        data: AlbumCreateResponse,
    ): void => {
        updateOverlayTask(overlayHandle, {
            text: t(I18nKey.interactionCommonProcessing),
        });
        const id = String(data.item?.id || "").trim();
        const shortId = String(data.item?.short_id || "").trim();
        const targetId = shortId || id;
        const encodedUsername = encodeURIComponent(username);
        navigateInternal(`/${encodedUsername}/albums/${targetId}?edit=1`);
    };

    const handleCreateResponse = (
        overlayHandle: number | null,
        response: Response,
        data: AlbumCreateResponse,
    ): boolean => {
        const id = String(data.item?.id || "").trim();
        const shortId = String(data.item?.short_id || "").trim();
        const targetId = shortId || id;
        if (!response.ok || !targetId) {
            const message =
                data.error?.message || t(I18nKey.interactionPostActionFailed);
            showError(message);
            resetSubmitBtn();
            return false;
        }
        handleCreateSuccess(overlayHandle, data);
        return true;
    };

    form.addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();
            errorElement?.classList.add("hidden");

            const title = validateTitle();
            if (!title) {
                return;
            }

            submitBtn?.setAttribute("disabled", "");
            if (submitBtn) {
                submitBtn.textContent = t(
                    I18nKey.interactionCommonCreateInProgress,
                );
            }
            const overlayHandle = startOverlayTask({
                title: t(I18nKey.contentAlbumCreateTitle),
                mode: "indeterminate",
                text: t(I18nKey.interactionCommonSubmitting),
            });

            try {
                const { response, data } = await fetchCreateAlbum(title);
                handleCreateResponse(overlayHandle, response, data);
            } catch (error) {
                console.error("[album-new] 创建相册失败:", error);
                showError(t(I18nKey.interactionPostActionFailed));
                resetSubmitBtn();
            } finally {
                finishOverlayTask(overlayHandle);
            }
        },
        { signal },
    );

    updateCounter();

    runtimeWindow.__albumNewCleanup = () => {
        abortController.abort();
        runtimeWindow.__albumNewCleanup = undefined;
    };
}
