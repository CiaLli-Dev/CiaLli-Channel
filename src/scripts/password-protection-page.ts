import { setupCodeCopyDelegation } from "@/scripts/code-copy";
import { scrollToHashBelowTocBaseline } from "@/utils/hash-scroll";
import "@/scripts/password-protection-helpers";

type PasswordRuntimeWindow = Window &
    typeof globalThis & {
        __passwordContentHashListenerBound?: boolean;
    };

const runtimeWindow = window as PasswordRuntimeWindow;

const handlePasswordContentReady = (): void => {
    if (!window.location.hash) {
        return;
    }
    scrollToHashBelowTocBaseline(window.location.hash, {
        behavior: "smooth",
    });
};

if (!runtimeWindow.__passwordContentHashListenerBound) {
    window.addEventListener(
        "cialli:password-content-ready",
        handlePasswordContentReady,
    );
    runtimeWindow.__passwordContentHashListenerBound = true;
}

setupCodeCopyDelegation();
