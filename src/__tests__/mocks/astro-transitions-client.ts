type TestNavigationWindow = Window &
    typeof globalThis & {
        __ASTRO_TRANSITIONS_NAVIGATE__?: (path: string) => void;
    };

function getTestNavigationWindow(): TestNavigationWindow | null {
    if (typeof window === "undefined") {
        return null;
    }
    return window as TestNavigationWindow;
}

export function navigate(path: string): void {
    const runtimeWindow = getTestNavigationWindow();
    if (runtimeWindow?.__ASTRO_TRANSITIONS_NAVIGATE__) {
        runtimeWindow.__ASTRO_TRANSITIONS_NAVIGATE__(path);
        return;
    }
    runtimeWindow?.location.assign(path);
}
