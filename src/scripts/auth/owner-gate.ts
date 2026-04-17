import { getAuthState, subscribeAuthState } from "@/scripts/auth/state";
import type { AuthState } from "@/scripts/auth/state";

const OWNER_ONLY_SELECTOR = "[data-owner-only][data-owner-id]";

type OwnerGateWindow = Window &
    typeof globalThis & {
        __cialliOwnerGateSubscribed?: boolean;
        __cialliOwnerGateSwapBound?: boolean;
    };

function applyOwnerGateState(
    state: AuthState,
    root: ParentNode = document,
): void {
    const elements = root.querySelectorAll<HTMLElement>(OWNER_ONLY_SELECTOR);
    for (const element of elements) {
        const ownerId = String(element.dataset.ownerId || "").trim();
        const isOwner =
            Boolean(ownerId) &&
            state.isLoggedIn &&
            Boolean(state.userId) &&
            state.userId === ownerId;

        element.hidden = !isOwner;
        if (isOwner) {
            element.removeAttribute("aria-hidden");
            continue;
        }
        element.setAttribute("aria-hidden", "true");
    }
}

export function initOwnerGates(root: ParentNode = document): void {
    applyOwnerGateState(getAuthState(), root);
}

export function bindOwnerGateSync(): void {
    const runtimeWindow = window as OwnerGateWindow;

    // 个人页会通过 Astro 局部切换反复执行脚本，这里统一去重订阅，
    // 避免 owner 控件在多次导航后重复绑定同一批事件。
    if (!runtimeWindow.__cialliOwnerGateSubscribed) {
        runtimeWindow.__cialliOwnerGateSubscribed = true;
        subscribeAuthState((state) => {
            applyOwnerGateState(state);
        });
    }

    if (!runtimeWindow.__cialliOwnerGateSwapBound) {
        runtimeWindow.__cialliOwnerGateSwapBound = true;
        document.addEventListener("astro:after-swap", () => {
            initOwnerGates();
        });
    }

    initOwnerGates();
}
