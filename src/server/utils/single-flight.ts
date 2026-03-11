type AsyncTask<TArgs extends readonly unknown[], TResult> = (
    ...args: TArgs
) => Promise<TResult>;

/**
 * 为同 key 的异步任务提供单飞保护，避免缓存 miss 时的并发击穿。
 */
export function createSingleFlightRunner<
    TArgs extends readonly unknown[],
    TResult,
>(
    task: AsyncTask<TArgs, TResult>,
    buildKey: (...args: TArgs) => string,
): AsyncTask<TArgs, TResult> {
    const pendingTasks = new Map<string, Promise<TResult>>();

    return async (...args: TArgs): Promise<TResult> => {
        const key = buildKey(...args);
        const existing = pendingTasks.get(key);
        if (existing) {
            return await existing;
        }

        const nextTask = task(...args).finally(() => {
            pendingTasks.delete(key);
        });
        pendingTasks.set(key, nextTask);
        return await nextTask;
    };
}
