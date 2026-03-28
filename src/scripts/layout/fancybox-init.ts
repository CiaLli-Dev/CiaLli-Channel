import {
    buildFancyboxZoomableImageTpl,
    resolveFancyboxSlideImageRequestAttributes,
} from "@/utils/fancybox-zoomable-image";

type FancyboxStatic = {
    bind: (selector: string, options?: object) => void;
    unbind: (selector: string) => void;
};

type FancyboxConfig = {
    Hash?: boolean | object;
    Toolbar?: object;
    animated?: boolean;
    dragToClose?: boolean;
    keyboard?: object;
    fitToView?: boolean;
    preload?: number;
    infinite?: boolean;
    Panzoom?: object;
    caption?: boolean;
    groupAll?: boolean;
    Carousel?: object;
    on?: Record<string, (...args: unknown[]) => void>;
    source?: (el: Element) => string | null;
};

const ALBUM_PREVIEW_GROUP = "album-photo-preview";

type FancyboxSlideLike = {
    index?: number;
    thumb?: string | HTMLImageElement | null;
    thumbEl?: {
        getAttribute: (name: string) => string | null;
    } | null;
    thumbSrc?: string | null;
    referrerPolicy?: unknown;
    crossOrigin?: unknown;
};

type FancyboxThumbsCarouselLike = {
    getContainer: () => Element | undefined;
};

type FancyboxThumbsPluginLike = {
    getCarousel: () => FancyboxThumbsCarouselLike | undefined;
};

type FancyboxCarouselLike = {
    getSlides: () => FancyboxSlideLike[];
    getPlugins: () => {
        Thumbs?: FancyboxThumbsPluginLike;
    };
};

type FancyboxImageRequestAttributes = ReturnType<
    typeof resolveFancyboxSlideImageRequestAttributes
>;

function syncFancyboxOpenState(open: boolean): void {
    const root = document.documentElement;
    root.classList.toggle("has-fancybox-open", open);
    document.body.classList.toggle("has-fancybox-open", open);
}

function syncThumbImageRequestAttributes(
    thumbImage: HTMLImageElement,
    imageAttributes: FancyboxImageRequestAttributes,
): boolean {
    const currentReferrerPolicy =
        thumbImage.getAttribute("referrerpolicy") || null;
    const currentCrossOrigin = thumbImage.getAttribute("crossorigin") || null;
    let changed = false;

    if (imageAttributes.referrerPolicy) {
        if (currentReferrerPolicy !== imageAttributes.referrerPolicy) {
            thumbImage.setAttribute(
                "referrerpolicy",
                imageAttributes.referrerPolicy,
            );
            changed = true;
        }
    } else if (currentReferrerPolicy !== null) {
        thumbImage.removeAttribute("referrerpolicy");
        changed = true;
    }

    if (imageAttributes.crossOrigin) {
        if (currentCrossOrigin !== imageAttributes.crossOrigin) {
            thumbImage.setAttribute("crossorigin", imageAttributes.crossOrigin);
            changed = true;
        }
    } else if (currentCrossOrigin !== null) {
        thumbImage.removeAttribute("crossorigin");
        changed = true;
    }

    return changed;
}

function retryThumbImageRequest(
    thumbImage: HTMLImageElement,
    src: string,
): void {
    const currentRetrySrc =
        thumbImage.dataset.fancyboxThumbRetriedSrc?.trim() || "";
    if (!src || currentRetrySrc === src) {
        return;
    }

    thumbImage.dataset.fancyboxThumbRetriedSrc = src;
    thumbImage.removeAttribute("src");
    thumbImage.setAttribute("src", src);
}

function syncFancyboxThumbAttributes(carousel: FancyboxCarouselLike): void {
    const thumbsCarousel = carousel.getPlugins().Thumbs?.getCarousel();
    const thumbsContainer = thumbsCarousel?.getContainer();
    if (!thumbsContainer) {
        return;
    }

    const slidesByIndex = new Map<number, FancyboxSlideLike>();
    for (const slide of carousel.getSlides()) {
        if (typeof slide.index === "number") {
            slidesByIndex.set(slide.index, slide);
        }
    }

    thumbsContainer
        .querySelectorAll<HTMLImageElement>("[index] img")
        .forEach((thumbImage) => {
            const slideIndex = Number(
                thumbImage.closest("[index]")?.getAttribute("index"),
            );
            if (!Number.isFinite(slideIndex)) {
                return;
            }

            const slide = slidesByIndex.get(slideIndex);
            if (!slide) {
                return;
            }

            const imageAttributes =
                resolveFancyboxSlideImageRequestAttributes(slide);
            const attributesChanged = syncThumbImageRequestAttributes(
                thumbImage,
                imageAttributes,
            );
            const currentSrc = String(
                thumbImage.getAttribute("src") ||
                    thumbImage.getAttribute("data-lazy-src") ||
                    "",
            ).trim();

            // 远处缩略图节点是在后续滚动过程中才动态挂进 DOM 的。
            // 如果没有先补齐 referrer/cors 属性，这些第三方图床请求会直接失败并留下黑色占位。
            if (
                currentSrc &&
                (attributesChanged ||
                    (thumbImage.complete && thumbImage.naturalWidth === 0))
            ) {
                retryThumbImageRequest(thumbImage, currentSrc);
            }
        });
}

export type FancyboxController = {
    initFancybox: () => Promise<void>;
    cleanupFancybox: () => void;
};

export function createFancyboxController(): FancyboxController {
    let fancyboxSelectors: string[] = [];
    let fancyboxInitializing = false;
    let Fancybox: FancyboxStatic | undefined;
    let thumbMutationObserver: MutationObserver | undefined;
    let thumbSyncFrame = 0;

    function cleanupThumbMutationObserver(): void {
        if (thumbSyncFrame) {
            cancelAnimationFrame(thumbSyncFrame);
            thumbSyncFrame = 0;
        }
        thumbMutationObserver?.disconnect();
        thumbMutationObserver = undefined;
    }

    function observeFancyboxThumbs(carousel: FancyboxCarouselLike): void {
        cleanupThumbMutationObserver();

        const thumbsContainer = carousel
            .getPlugins()
            .Thumbs?.getCarousel()
            ?.getContainer();
        if (!thumbsContainer) {
            return;
        }

        const scheduleSync = (): void => {
            if (thumbSyncFrame) {
                cancelAnimationFrame(thumbSyncFrame);
            }
            thumbSyncFrame = requestAnimationFrame(() => {
                thumbSyncFrame = 0;
                syncFancyboxThumbAttributes(carousel);
            });
        };

        thumbMutationObserver = new MutationObserver(() => {
            scheduleSync();
        });
        thumbMutationObserver.observe(thumbsContainer, {
            childList: true,
            subtree: true,
        });

        scheduleSync();
    }

    async function initFancybox(): Promise<void> {
        if (fancyboxInitializing || fancyboxSelectors.length > 0) {
            return;
        }

        const markdownImagesSelector =
            ".custom-md img, #post-cover img, .moment-images img";
        const albumPhotoSelector = `.dc-album-gallery [data-fancybox='${ALBUM_PREVIEW_GROUP}']`;
        const genericFancyboxSelector = `[data-fancybox]:not([data-fancybox='${ALBUM_PREVIEW_GROUP}'])`;

        fancyboxInitializing = true;
        try {
            if (!Fancybox) {
                const mod = await import("@fancyapps/ui");
                Fancybox = mod.Fancybox as FancyboxStatic;
                await import("@fancyapps/ui/dist/fancybox/fancybox.css");
            }

            if (fancyboxSelectors.length > 0) {
                return;
            }

            const fancybox = Fancybox;
            if (!fancybox) {
                return;
            }

            const commonThumbsConfig = {
                showOnStart: true,
                thumbTpl:
                    '<button aria-label="Slide to #{{page}}"><img draggable="false" alt="{{alt}}" src="{{src}}" /></button>',
            };

            const commonCarouselConfig = {
                Thumbs: commonThumbsConfig,
                Zoomable: {
                    tpl: buildFancyboxZoomableImageTpl,
                },
            };

            const commonConfig: FancyboxConfig = {
                Hash: false,
                Toolbar: {
                    display: {
                        left: ["infobar"],
                        middle: [
                            "zoomIn",
                            "zoomOut",
                            "toggle1to1",
                            "rotateCCW",
                            "rotateCW",
                            "flipX",
                            "flipY",
                        ],
                        right: ["slideshow", "thumbs", "close"],
                    },
                },
                animated: true,
                dragToClose: true,
                keyboard: {
                    Escape: "close",
                    Delete: "close",
                    Backspace: "close",
                    PageUp: "next",
                    PageDown: "prev",
                    ArrowUp: "next",
                    ArrowDown: "prev",
                    ArrowRight: "next",
                    ArrowLeft: "prev",
                },
                fitToView: true,
                preload: 3,
                infinite: true,
                Panzoom: { maxScale: 3, minScale: 1 },
                caption: false,
                Carousel: commonCarouselConfig,
                on: {
                    ready: () => {
                        syncFancyboxOpenState(true);
                    },
                    "Carousel.thumbs:ready": (
                        _instance: unknown,
                        carousel: unknown,
                    ) => {
                        const fancyboxCarousel = carousel as
                            | FancyboxCarouselLike
                            | undefined;
                        if (fancyboxCarousel) {
                            observeFancyboxThumbs(fancyboxCarousel);
                            syncFancyboxThumbAttributes(fancyboxCarousel);
                        }
                    },
                    destroy: () => {
                        cleanupThumbMutationObserver();
                        syncFancyboxOpenState(false);
                    },
                },
            };

            const albumConfig: FancyboxConfig = {
                ...commonConfig,
                Toolbar: {
                    display: {
                        left: ["infobar"],
                        middle: [
                            "zoomOut",
                            "zoomIn",
                            "toggle1to1",
                            "rotateCCW",
                            "rotateCW",
                        ],
                        right: ["close"],
                    },
                },
            };

            // 始终注册选择器代理，避免评论等异步渲染场景漏绑导致回退到浏览器原生预览。
            fancybox.bind(markdownImagesSelector, {
                ...commonConfig,
                groupAll: true,
                Carousel: {
                    ...commonCarouselConfig,
                    transition: "slide",
                    preload: 2,
                },
            });
            fancyboxSelectors.push(markdownImagesSelector);

            fancybox.bind(albumPhotoSelector, albumConfig);
            fancyboxSelectors.push(albumPhotoSelector);

            fancybox.bind(genericFancyboxSelector, {
                ...commonConfig,
                source: (el: Element) => {
                    return (
                        el.getAttribute("data-src") || el.getAttribute("href")
                    );
                },
            });
            fancyboxSelectors.push(genericFancyboxSelector);
        } finally {
            fancyboxInitializing = false;
        }
    }

    function cleanupFancybox(): void {
        const fancybox = Fancybox;
        cleanupThumbMutationObserver();
        syncFancyboxOpenState(false);
        if (!fancybox) {
            return;
        }
        fancyboxSelectors.forEach((selector) => {
            fancybox.unbind(selector);
        });
        fancyboxSelectors = [];
        fancyboxInitializing = false;
    }

    return {
        initFancybox,
        cleanupFancybox,
    };
}
