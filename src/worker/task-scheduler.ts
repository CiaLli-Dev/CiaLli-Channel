export type SchedulerTrigger = "startup" | "interval";

export function createNonOverlappingScheduler(params: {
    task: (trigger: SchedulerTrigger) => Promise<void>;
}) {
    let running = false;

    return {
        async run(trigger: SchedulerTrigger): Promise<void> {
            if (running) {
                return;
            }

            running = true;
            try {
                await params.task(trigger);
            } finally {
                running = false;
            }
        },
    };
}
