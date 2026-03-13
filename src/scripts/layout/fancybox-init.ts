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
    Thumbs?: object;
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
    thumbEl?: {
        getAttribute: (name: string) => string | null;
    } | null;
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

function syncFancyboxThumbAttributes(carousel: FancyboxCarouselLike): void {
    const thumbsCarousel = carousel.getPlugins().Thumbs?.getCarousel();
    const thumbsContainer = thumbsCarousel?.getContainer();
    if (!thumbsContainer) {
        return;
    }

    for (const slide of carousel.getSlides()) {
        const slideIndex =
            typeof slide.index === "number" ? slide.index : undefined;
        if (slideIndex === undefined) {
            continue;
        }

        const thumbImage = thumbsContainer.querySelector<HTMLImageElement>(
            `[index="${slideIndex}"] img`,
        );
        if (!thumbImage) {
            continue;
        }

        const imageAttributes =
            resolveFancyboxSlideImageRequestAttributes(slide);
        if (imageAttributes.referrerPolicy) {
            thumbImage.setAttribute(
                "referrerpolicy",
                imageAttributes.referrerPolicy,
            );
        } else {
            thumbImage.removeAttribute("referrerpolicy");
        }

        if (imageAttributes.crossOrigin) {
            thumbImage.setAttribute("crossorigin", imageAttributes.crossOrigin);
        } else {
            thumbImage.removeAttribute("crossorigin");
        }
    }
}

export type FancyboxController = {
    initFancybox: () => Promise<void>;
    cleanupFancybox: () => void;
};

export function createFancyboxController(): FancyboxController {
    let fancyboxSelectors: string[] = [];
    let fancyboxInitializing = false;
    let Fancybox: FancyboxStatic | undefined;

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

            const commonConfig: FancyboxConfig = {
                Hash: false,
                Thumbs: {
                    autoStart: true,
                    showOnStart: "yes",
                },
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
                Carousel: {
                    Zoomable: {
                        tpl: buildFancyboxZoomableImageTpl,
                    },
                },
                on: {
                    "Carousel.thumbs:ready": (
                        _instance: unknown,
                        carousel: unknown,
                    ) => {
                        const fancyboxCarousel = carousel as
                            | FancyboxCarouselLike
                            | undefined;
                        if (fancyboxCarousel) {
                            syncFancyboxThumbAttributes(fancyboxCarousel);
                        }
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
                    Zoomable: {
                        tpl: buildFancyboxZoomableImageTpl,
                    },
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
