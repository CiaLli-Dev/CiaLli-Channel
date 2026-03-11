import { describe, expect, it, vi } from "vitest";

import { createSingleFlightRunner } from "@/server/utils/single-flight";

describe("createSingleFlightRunner", () => {
    it("相同 key 的并发任务只执行一次", async () => {
        const task = vi.fn(
            async (key: string, value: number): Promise<string> =>
                `${key}:${value}`,
        );
        const run = createSingleFlightRunner(task, (key: string) => key);

        const [first, second, third] = await Promise.all([
            run("site-settings", 1),
            run("site-settings", 2),
            run("site-settings", 3),
        ]);

        expect(first).toBe("site-settings:1");
        expect(second).toBe("site-settings:1");
        expect(third).toBe("site-settings:1");
        expect(task).toHaveBeenCalledTimes(1);
    });

    it("不同 key 的任务互不影响", async () => {
        const task = vi.fn(
            async (key: string, value: number): Promise<string> =>
                `${key}:${value}`,
        );
        const run = createSingleFlightRunner(task, (key: string) => key);

        const [alpha, beta] = await Promise.all([
            run("alpha", 1),
            run("beta", 2),
        ]);

        expect(alpha).toBe("alpha:1");
        expect(beta).toBe("beta:2");
        expect(task).toHaveBeenCalledTimes(2);
    });
});
