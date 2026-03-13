type CarouselController = {
    setPaused: (paused: boolean) => void;
};

type BannerWindow = Window &
    typeof globalThis & {
        __bannerCarouselController?: CarouselController;
        __updateBannerCarouselState?: () => void;
    };

const BANNER_CAROUSEL_ID = "banner-carousel";

function isBannerVisibleByState(): boolean {
    const mode = document.body.dataset.layoutMode;
    return mode === "banner";
}

function getRuntimeWindow(): BannerWindow {
    return window as BannerWindow;
}

export function updateBannerCarouselState(): void {
    const runtimeWindow = getRuntimeWindow();
    const controller = runtimeWindow.__bannerCarouselController;
    if (!controller || typeof controller.setPaused !== "function") {
        return;
    }
    const bannerWrapper = document.getElementById("banner-wrapper");
    const isBannerHidden =
        bannerWrapper?.classList.contains("wallpaper-layer-hidden") === true;
    controller.setPaused(!isBannerVisibleByState() || isBannerHidden);
}

export function initBannerCarousel(): void {
    const runtimeWindow = getRuntimeWindow();
    const existingController = runtimeWindow.__bannerCarouselController;
    if (
        existingController &&
        typeof existingController.setPaused === "function"
    ) {
        updateBannerCarouselState();
        return;
    }

    const carouselItems =
        document.querySelectorAll<HTMLElement>(".carousel-item");
    const validItems = Array.from(carouselItems).filter((item) =>
        item.querySelector(".banner-image"),
    );
    const carouselConfig =
        runtimeWindow.__CIALLI_RUNTIME_SETTINGS__?.settings.banner.carousel;

    if (validItems.length <= 1 || !carouselConfig?.enable) {
        return;
    }

    let currentIndex = 0;
    const interval = carouselConfig.interval || 6;
    let carouselInterval: number | undefined;
    let isPaused = false;

    const carousel = document.getElementById(BANNER_CAROUSEL_ID);

    function switchToSlide(index: number): void {
        const currentItem = validItems[currentIndex];
        currentItem.classList.remove("opacity-100", "scale-100");
        currentItem.classList.add("opacity-0", "scale-110");

        currentIndex = index;

        const nextItem = validItems[currentIndex];
        nextItem.classList.add("opacity-100", "scale-100");
        nextItem.classList.remove("opacity-0", "scale-110");
    }

    carouselItems.forEach((item) => {
        item.classList.add("opacity-0", "scale-110");
        item.classList.remove("opacity-100", "scale-100");
    });

    if (validItems.length > 0) {
        validItems[0].classList.add("opacity-100", "scale-100");
        validItems[0].classList.remove("opacity-0", "scale-110");
    }

    function startCarousel(): void {
        clearInterval(carouselInterval);
        carouselInterval = window.setInterval(() => {
            if (!isPaused) {
                switchToSlide((currentIndex + 1) % validItems.length);
            }
        }, interval * 1000);
    }

    function setPaused(paused: boolean): void {
        isPaused = paused;
        if (paused) {
            clearInterval(carouselInterval);
        } else {
            startCarousel();
        }
    }

    runtimeWindow.__bannerCarouselController = { setPaused };
    if (carousel) {
        carousel.addEventListener("mouseenter", () => {
            isPaused = true;
            clearInterval(carouselInterval);
        });
        carousel.addEventListener("mouseleave", () => {
            isPaused = false;
            startCarousel();
        });
    }

    startCarousel();
    updateBannerCarouselState();
}

export function resetBannerCarousel(): void {
    const runtimeWindow = getRuntimeWindow();
    const controller = runtimeWindow.__bannerCarouselController;
    if (controller) {
        controller.setPaused(true);
    }
    runtimeWindow.__bannerCarouselController = undefined;
}

export function showBanner(): void {
    requestAnimationFrame(() => {
        const banner = document.getElementById("banner");
        if (banner) {
            banner.classList.remove("opacity-0", "scale-105");
        }

        if (document.getElementById(BANNER_CAROUSEL_ID)) {
            initBannerCarousel();
            updateBannerCarouselState();
        }
    });
}

export function setupBannerRuntime(): void {
    const runtimeWindow = getRuntimeWindow();
    runtimeWindow.__updateBannerCarouselState = updateBannerCarouselState;
}
