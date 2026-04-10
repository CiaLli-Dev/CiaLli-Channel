import I18nKey from "@i18n/i18nKey";

import { t } from "@/scripts/shared/i18n-runtime";
import {
    copyTextToClipboard,
    downloadSharePosterImage,
    generateSharePosterImage,
    resolveShareThemeColor,
    type SharePosterPayload,
} from "@/utils/share-poster";

const ARTICLE_SHARE_OPEN_EVENT = "cialli:article-share:open";
const NAVIGATION_SETTLED_EVENT = "cialli:navigation:settled";
const COPY_FEEDBACK_DURATION = 2000;
const dialogOpeners = new Map<string, () => void>();

type ShareDialogElements = {
    closeBtn: HTMLButtonElement | null;
    copyBtn: HTMLButtonElement | null;
    copyText: HTMLElement | null;
    downloadBtn: HTMLButtonElement | null;
    loading: HTMLElement | null;
    image: HTMLImageElement | null;
    status: HTMLElement | null;
    payloadNode: HTMLTemplateElement | null;
};

type ShareDialogRuntimeWindow = Window &
    typeof globalThis & {
        cialliOpenArticleShareDialog?: (dialogId: string) => void;
        __articleShareGlobalOpenBound?: boolean;
        __articleShareSettledInitBound?: boolean;
    };

function queryDialogElements(rootEl: HTMLElement): ShareDialogElements {
    return {
        closeBtn: rootEl.querySelector<HTMLButtonElement>("[data-share-close]"),
        copyBtn: rootEl.querySelector<HTMLButtonElement>("[data-share-copy]"),
        copyText: rootEl.querySelector<HTMLElement>("[data-share-copy-text]"),
        downloadBtn: rootEl.querySelector<HTMLButtonElement>(
            "[data-share-download]",
        ),
        loading: rootEl.querySelector<HTMLElement>("[data-share-loading]"),
        image: rootEl.querySelector<HTMLImageElement>("[data-share-image]"),
        status: rootEl.querySelector<HTMLElement>("[data-share-status]"),
        payloadNode: rootEl.querySelector<HTMLTemplateElement>(
            "template[data-share-payload]",
        ),
    };
}

function readRequiredString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

function decodeHtmlEntities(value: string): string {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
}

function parseSharePayload(jsonText: string): SharePosterPayload | null {
    const trimmed = decodeHtmlEntities(jsonText).trim();
    if (!trimmed) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch (error) {
        console.error("[article-share-dialog] invalid payload json:", error);
        return null;
    }

    if (!parsed || typeof parsed !== "object") {
        return null;
    }

    const record = parsed as Record<string, unknown>;
    const title = readRequiredString(record.title);
    const author = readRequiredString(record.author);
    const description = readRequiredString(record.description);
    const pubDate = readRequiredString(record.pubDate);
    const url = readRequiredString(record.url);
    const siteTitle = readRequiredString(record.siteTitle);
    const coverImage = readOptionalString(record.coverImage);
    const avatar = readOptionalString(record.avatar);

    if (!url || !siteTitle) {
        return null;
    }

    return {
        title,
        author,
        description,
        pubDate,
        coverImage,
        url,
        siteTitle,
        avatar,
        hiddenUntilDecrypt: record.hiddenUntilDecrypt === true,
    };
}

function setStatus(
    statusEl: HTMLElement | null,
    message: string,
    tone: "default" | "success" | "danger" = "default",
): void {
    if (!statusEl) {
        return;
    }

    const content = message.trim();
    if (!content) {
        statusEl.textContent = "";
        statusEl.hidden = true;
        delete statusEl.dataset.tone;
        return;
    }

    statusEl.textContent = content;
    statusEl.dataset.tone = tone;
    statusEl.hidden = false;
}

function setLoadingState(
    elements: ShareDialogElements,
    loading: boolean,
    hasPosterImage: boolean,
): void {
    if (elements.loading) {
        elements.loading.hidden = !loading;
    }
    if (elements.image) {
        elements.image.hidden = !hasPosterImage;
    }
    if (elements.downloadBtn) {
        elements.downloadBtn.disabled = !hasPosterImage;
    }
}

function closeDialog(
    rootEl: HTMLElement,
    savedOverflow: string,
    onKeyDown: (event: KeyboardEvent) => void,
): void {
    if (rootEl.hidden) {
        return;
    }

    rootEl.classList.add("is-closing");
    document.removeEventListener("keydown", onKeyDown);

    let closed = false;
    const finishClose = () => {
        if (closed) {
            return;
        }
        closed = true;
        rootEl.hidden = true;
        rootEl.classList.add("hidden");
        rootEl.classList.remove("is-closing");
        document.body.style.overflow = savedOverflow;
    };

    rootEl.addEventListener("animationend", finishClose, { once: true });
    window.setTimeout(finishClose, 220);
}

function bindArticleShareDialog(rootEl: HTMLElement): void {
    rootEl.dataset.bound = "1";

    const elements = queryDialogElements(rootEl);
    const parsedPayload = parseSharePayload(
        elements.payloadNode?.innerHTML || "",
    );
    if (!parsedPayload) {
        console.error("[article-share-dialog] missing valid payload");
        return;
    }
    const payload = parsedPayload;

    let posterImage = "";
    let posterLoading = false;
    let savedOverflow = "";
    let copyFeedbackTimer = 0;

    function resetCopyLabel(): void {
        if (elements.copyText) {
            elements.copyText.textContent = t(
                I18nKey.contentCopyLink,
                "复制链接",
            );
        }
    }

    function markCopied(): void {
        if (copyFeedbackTimer) {
            window.clearTimeout(copyFeedbackTimer);
        }
        if (elements.copyText) {
            elements.copyText.textContent = t(I18nKey.contentCopied, "已复制");
        }
        copyFeedbackTimer = window.setTimeout(() => {
            resetCopyLabel();
        }, COPY_FEEDBACK_DURATION);
    }

    async function ensurePosterImage(): Promise<void> {
        if (posterImage || posterLoading) {
            return;
        }

        posterLoading = true;
        setStatus(elements.status, "");
        setLoadingState(elements, true, false);

        try {
            // 海报生成集中走共享工具，避免多个入口出现样式和文案漂移。
            posterImage = await generateSharePosterImage(payload, {
                themeColor: resolveShareThemeColor(),
                authorLabel: t(I18nKey.author, "作者"),
                scanLabel: t(I18nKey.contentScanToRead, "扫码阅读"),
            });
            if (elements.image) {
                elements.image.src = posterImage;
                elements.image.alt =
                    payload.title.trim() ||
                    t(I18nKey.contentShareArticle, "分享");
            }
            setLoadingState(elements, false, true);
        } catch (error) {
            console.error(
                "[article-share-dialog] generate poster failed:",
                error,
            );
            setLoadingState(elements, false, false);
            setStatus(
                elements.status,
                t(
                    I18nKey.contentSharePosterFailed,
                    "海报生成失败，请稍后重试。",
                ),
                "danger",
            );
        } finally {
            posterLoading = false;
        }
    }

    function openDialog(): void {
        if (!rootEl.hidden) {
            return;
        }
        savedOverflow = document.body.style.overflow;
        rootEl.hidden = false;
        rootEl.classList.remove("hidden", "is-closing");
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", onKeyDown);
        void ensurePosterImage();
    }

    dialogOpeners.set(rootEl.id, openDialog);

    function onKeyDown(event: KeyboardEvent): void {
        if (event.key !== "Escape") {
            return;
        }
        event.preventDefault();
        closeDialog(rootEl, savedOverflow, onKeyDown);
    }

    // 直接在弹层脚本里接管分享按钮点击，避免跨模块 opener 时序导致入口失效。
    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const shareBtn = target.closest<HTMLButtonElement>(".detail-share-btn");
        if (!shareBtn) {
            return;
        }
        const floatRoot = shareBtn.closest<HTMLElement>(".detail-action-float");
        if (!floatRoot) {
            return;
        }
        if (
            String(floatRoot.dataset.shareDialogId || "").trim() !== rootEl.id
        ) {
            return;
        }
        openDialog();
    });

    rootEl.addEventListener("click", (event) => {
        if (event.target === rootEl) {
            closeDialog(rootEl, savedOverflow, onKeyDown);
        }
    });

    elements.closeBtn?.addEventListener("click", () => {
        closeDialog(rootEl, savedOverflow, onKeyDown);
    });

    elements.copyBtn?.addEventListener("click", async () => {
        try {
            await copyTextToClipboard(payload.url);
            setStatus(elements.status, "", "default");
            markCopied();
        } catch (error) {
            console.error("[article-share-dialog] copy link failed:", error);
            setStatus(
                elements.status,
                t(I18nKey.contentShareCopyFailed, "复制链接失败，请稍后重试。"),
                "danger",
            );
            resetCopyLabel();
        }
    });

    elements.downloadBtn?.addEventListener("click", () => {
        if (!posterImage) {
            return;
        }
        downloadSharePosterImage(
            posterImage,
            payload.title || payload.siteTitle,
        );
    });

    document.addEventListener(ARTICLE_SHARE_OPEN_EVENT, (event) => {
        const openEvent = event as CustomEvent<string>;
        if (openEvent.detail !== rootEl.id) {
            return;
        }
        openDialog();
    });
}

function initArticleShareDialog(): void {
    const roots = document.querySelectorAll<HTMLElement>(
        "[data-article-share-dialog]:not([data-bound='1'])",
    );
    roots.forEach((rootEl) => bindArticleShareDialog(rootEl));
}

const runtimeWindow = window as ShareDialogRuntimeWindow;

if (!runtimeWindow.__articleShareGlobalOpenBound) {
    runtimeWindow.__articleShareGlobalOpenBound = true;
    runtimeWindow.cialliOpenArticleShareDialog = (dialogId: string): void => {
        const opener = dialogOpeners.get(dialogId);
        if (opener) {
            opener();
            return;
        }
        document.dispatchEvent(
            new CustomEvent<string>(ARTICLE_SHARE_OPEN_EVENT, {
                detail: dialogId,
            }),
        );
    };
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initArticleShareDialog, {
        once: true,
    });
} else {
    initArticleShareDialog();
}

if (!runtimeWindow.__articleShareSettledInitBound) {
    runtimeWindow.__articleShareSettledInitBound = true;
    document.addEventListener(NAVIGATION_SETTLED_EVENT, initArticleShareDialog);
}
