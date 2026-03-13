const CACHE_INVALIDATION_TIMEOUT_MS = 1_500;

type CacheInvalidationOptions = {
    label: string;
    timeoutMs?: number;
};

/**
 * 统一等待缓存失效任务：在可控超时内尽可能完成，失败仅记录日志不阻断主流程。
 */
export async function awaitCacheInvalidations(
    tasks: Array<Promise<unknown>>,
    options: CacheInvalidationOptions,
): Promise<void> {
    if (tasks.length === 0) {
        return;
    }

    const timeoutMs = Math.max(
        100,
        Math.floor(options.timeoutMs ?? CACHE_INVALIDATION_TIMEOUT_MS),
    );

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
        timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
        if (
            typeof timeoutHandle === "object" &&
            timeoutHandle !== null &&
            "unref" in timeoutHandle &&
            typeof timeoutHandle.unref === "function"
        ) {
            timeoutHandle.unref();
        }
    });

    const outcome = await Promise.race([
        Promise.allSettled(tasks),
        timeoutPromise,
    ]);
    if (timeoutHandle) {
        clearTimeout(timeoutHandle);
    }

    if (outcome === "timeout") {
        console.warn(
            `[cache/invalidation] ${options.label} 超时(${timeoutMs}ms)，已降级为异步完成`,
        );
        return;
    }

    const failedTasks = outcome.filter((task) => task.status === "rejected");
    if (failedTasks.length > 0) {
        console.warn(
            `[cache/invalidation] ${options.label} 失败 ${failedTasks.length}/${outcome.length}`,
            failedTasks.map((task) =>
                task.status === "rejected" ? task.reason : null,
            ),
        );
    }
}
