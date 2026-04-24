import { describe, expect, it, vi } from "vitest";

import { createNonOverlappingScheduler } from "@/worker/task-scheduler";

describe("task-scheduler", () => {
    it("does not overlap concurrent runs", async () => {
        const releaseRef: { current: (() => void) | null } = { current: null };
        const task = vi.fn(
            async () =>
                await new Promise<void>((resolve) => {
                    releaseRef.current = resolve;
                }),
        );
        const scheduler = createNonOverlappingScheduler({ task });

        const firstRun = scheduler.run("startup");
        const secondRun = scheduler.run("interval");

        expect(task).toHaveBeenCalledTimes(1);

        if (releaseRef.current) {
            releaseRef.current();
        }
        await firstRun;
        await secondRun;

        expect(task).toHaveBeenCalledTimes(1);
    });
});
