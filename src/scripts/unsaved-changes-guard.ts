type UnsavedChangesGuardOptions = {
    isDirty: () => boolean;
    getConfirmMessage: () => string;
};

/**
 * 编辑页未保存拦截（浏览器原生模式）：
 * 1) 仅使用 beforeunload，统一交给浏览器原生离开确认。
 * 2) 守卫启用期间临时关闭 Astro View Transitions，避免前进/后退触发过渡骨架。
 */
export function setupUnsavedChangesGuard(
    options: UnsavedChangesGuardOptions,
): () => void {
    const controller = new AbortController();
    const transitionsMeta = document.head.querySelector<HTMLMetaElement>(
        'meta[name="astro-view-transitions-enabled"]',
    );
    const transitionsMetaParent = transitionsMeta?.parentNode ?? null;
    const transitionsMetaNextSibling = transitionsMeta?.nextSibling ?? null;

    if (transitionsMeta) {
        // 关键：编辑页期间禁用 ClientRouter 过渡，回退到浏览器原生导航链路。
        transitionsMeta.remove();
    }

    const isDirtySafely = (): boolean => {
        try {
            return options.isDirty();
        } catch (error) {
            // 脏状态判断异常时按“有改动”处理，防止漏拦截。
            console.error("[unsaved-guard] isDirty failed:", error);
            return true;
        }
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
        if (!isDirtySafely()) {
            return;
        }
        event.preventDefault();
        Reflect.set(event, "returnValue", options.getConfirmMessage());
    };

    window.addEventListener("beforeunload", handleBeforeUnload, {
        signal: controller.signal,
    });

    return () => {
        controller.abort();

        if (
            transitionsMeta &&
            transitionsMetaParent &&
            !document.head.querySelector(
                'meta[name="astro-view-transitions-enabled"]',
            )
        ) {
            // 页面未离开且守卫销毁时，恢复 View Transitions 元信息。
            transitionsMetaParent.insertBefore(
                transitionsMeta,
                transitionsMetaNextSibling,
            );
        }
    };
}
