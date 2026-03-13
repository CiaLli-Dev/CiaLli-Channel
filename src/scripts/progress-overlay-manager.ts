export type ProgressOverlayMode = "determinate" | "indeterminate";

export type ProgressTaskOptions = {
    title?: string;
    text?: string;
    mode?: ProgressOverlayMode;
    percent?: number;
    delayMs?: number;
};

export type ProgressTaskStage = {
    title?: string;
    text?: string;
    mode?: ProgressOverlayMode;
    percent?: number;
};

export type ProgressTaskHandle = number;

export type ProgressTaskRunnerContext = {
    handle: ProgressTaskHandle;
    update: (stage: ProgressTaskStage) => void;
};

export interface ProgressOverlayApi {
    startTask: (options?: ProgressTaskOptions) => ProgressTaskHandle;
    updateTask: (handle: ProgressTaskHandle, stage: ProgressTaskStage) => void;
    finishTask: (handle: ProgressTaskHandle) => void;
    runWithTask: <T>(
        options: ProgressTaskOptions | undefined,
        runner: (context: ProgressTaskRunnerContext) => Promise<T> | T,
    ) => Promise<T>;
}

type TaskEntry = {
    id: ProgressTaskHandle;
    title: string;
    text: string;
    mode: ProgressOverlayMode;
    percent: number;
    delayMs: number;
    shown: boolean;
    timerId: number | null;
};

const DEFAULT_DELAY_MS = 300;
const DEFAULT_TITLE = "处理中";

class ProgressOverlayManager implements ProgressOverlayApi {
    private sequence = 0;

    private readonly tasks = new Map<ProgressTaskHandle, TaskEntry>();

    private readonly taskOrder: ProgressTaskHandle[] = [];

    private container: HTMLDivElement | null = null;

    private titleEl: HTMLHeadingElement | null = null;

    private textEl: HTMLParagraphElement | null = null;

    private trackEl: HTMLDivElement | null = null;

    private fillEl: HTMLDivElement | null = null;

    private percentEl: HTMLDivElement | null = null;

    startTask(options: ProgressTaskOptions = {}): ProgressTaskHandle {
        const handle = ++this.sequence;
        const mode =
            this.resolveMode(options.mode, options.percent) ?? "indeterminate";
        const entry: TaskEntry = {
            id: handle,
            title: this.normalizeTitle(options.title),
            text: this.normalizeText(options.text),
            mode,
            percent: this.normalizePercent(options.percent),
            delayMs: this.normalizeDelay(options.delayMs),
            shown: false,
            timerId: null,
        };

        this.tasks.set(handle, entry);
        this.taskOrder.push(handle);

        if (entry.delayMs <= 0) {
            entry.shown = true;
        } else if (typeof window !== "undefined") {
            entry.timerId = window.setTimeout(() => {
                const current = this.tasks.get(handle);
                if (!current) {
                    return;
                }
                current.shown = true;
                current.timerId = null;
                this.render();
            }, entry.delayMs);
        }

        this.render();
        return handle;
    }

    updateTask(handle: ProgressTaskHandle, stage: ProgressTaskStage): void {
        const entry = this.tasks.get(handle);
        if (!entry) {
            return;
        }

        if (stage.title !== undefined) {
            entry.title = this.normalizeTitle(stage.title);
        }
        if (stage.text !== undefined) {
            entry.text = this.normalizeText(stage.text);
        }

        const nextMode = this.resolveMode(stage.mode, stage.percent);
        if (nextMode) {
            entry.mode = nextMode;
        }
        if (stage.percent !== undefined) {
            entry.percent = this.normalizePercent(stage.percent);
        }
        this.render();
    }

    finishTask(handle: ProgressTaskHandle): void {
        const entry = this.tasks.get(handle);
        if (!entry) {
            return;
        }
        if (entry.timerId !== null && typeof window !== "undefined") {
            window.clearTimeout(entry.timerId);
        }
        this.tasks.delete(handle);
        const index = this.taskOrder.indexOf(handle);
        if (index >= 0) {
            this.taskOrder.splice(index, 1);
        }
        this.render();
    }

    async runWithTask<T>(
        options: ProgressTaskOptions = {},
        runner: (context: ProgressTaskRunnerContext) => Promise<T> | T,
    ): Promise<T> {
        const handle = this.startTask(options);
        try {
            return await runner({
                handle,
                update: (stage: ProgressTaskStage) => {
                    this.updateTask(handle, stage);
                },
            });
        } finally {
            this.finishTask(handle);
        }
    }

    private render(): void {
        const entry = this.resolveDisplayTask();
        if (!entry) {
            this.hideOverlay();
            return;
        }

        this.ensureDom();
        if (
            !this.container ||
            !this.titleEl ||
            !this.textEl ||
            !this.trackEl ||
            !this.fillEl ||
            !this.percentEl
        ) {
            return;
        }

        this.titleEl.textContent = entry.title;
        this.textEl.textContent = entry.text;
        this.textEl.classList.toggle("hidden", !entry.text);

        const isDeterminate = entry.mode === "determinate";
        this.trackEl.classList.toggle("is-indeterminate", !isDeterminate);
        this.fillEl.style.width = isDeterminate ? `${entry.percent}%` : "40%";
        this.percentEl.classList.toggle("hidden", !isDeterminate);
        this.percentEl.textContent = `${entry.percent}%`;

        this.container.hidden = false;
        document.body.classList.add("dc-progress-overlay-lock");
    }

    private resolveDisplayTask(): TaskEntry | null {
        for (let index = this.taskOrder.length - 1; index >= 0; index -= 1) {
            const id = this.taskOrder[index];
            const entry = this.tasks.get(id);
            if (entry && entry.shown) {
                return entry;
            }
        }
        return null;
    }

    private hideOverlay(): void {
        if (this.container) {
            this.container.hidden = true;
        }
        document.body.classList.remove("dc-progress-overlay-lock");
    }

    private ensureDom(): void {
        if (this.container) {
            return;
        }
        const overlay = document.createElement("div");
        overlay.className = "dc-progress-overlay";
        overlay.hidden = true;

        const card = document.createElement("div");
        card.className = "dc-progress-overlay-card card-base";

        const title = document.createElement("h3");
        title.className = "dc-progress-overlay-title";
        title.textContent = DEFAULT_TITLE;

        const text = document.createElement("p");
        text.className = "dc-progress-overlay-text hidden";

        const track = document.createElement("div");
        track.className = "dc-progress-overlay-track";

        const fill = document.createElement("div");
        fill.className = "dc-progress-overlay-fill";
        fill.style.width = "0%";
        track.appendChild(fill);

        const percent = document.createElement("div");
        percent.className = "dc-progress-overlay-percent";
        percent.textContent = "0%";

        card.appendChild(title);
        card.appendChild(text);
        card.appendChild(track);
        card.appendChild(percent);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        this.container = overlay;
        this.titleEl = title;
        this.textEl = text;
        this.trackEl = track;
        this.fillEl = fill;
        this.percentEl = percent;
    }

    private normalizeTitle(input: string | undefined): string {
        const value = String(input || "").trim();
        return value || DEFAULT_TITLE;
    }

    private normalizeText(input: string | undefined): string {
        return String(input || "").trim();
    }

    private normalizePercent(input: number | undefined): number {
        const value = Number(input);
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, Math.min(100, Math.round(value)));
    }

    private normalizeDelay(input: number | undefined): number {
        const value = Number(input);
        if (!Number.isFinite(value)) {
            return DEFAULT_DELAY_MS;
        }
        return Math.max(0, Math.round(value));
    }

    private resolveMode(
        mode: ProgressOverlayMode | undefined,
        percent: number | undefined,
    ): ProgressOverlayMode | undefined {
        if (mode === "determinate" || mode === "indeterminate") {
            return mode;
        }
        if (percent !== undefined) {
            return "determinate";
        }
        return undefined;
    }
}

let singleton: ProgressOverlayManager | null = null;

const getSingleton = (): ProgressOverlayManager => {
    if (!singleton) {
        singleton = new ProgressOverlayManager();
    }
    return singleton;
};

export const startTask = (
    options?: ProgressTaskOptions,
): ProgressTaskHandle => {
    return getSingleton().startTask(options);
};

export const updateTask = (
    handle: ProgressTaskHandle,
    stage: ProgressTaskStage,
): void => {
    getSingleton().updateTask(handle, stage);
};

export const finishTask = (handle: ProgressTaskHandle): void => {
    getSingleton().finishTask(handle);
};

export const runWithTask = async <T>(
    options: ProgressTaskOptions | undefined,
    runner: (context: ProgressTaskRunnerContext) => Promise<T> | T,
): Promise<T> => {
    return await getSingleton().runWithTask(options, runner);
};

export const getProgressOverlayApi = (): ProgressOverlayApi => {
    const manager = getSingleton();
    return {
        startTask: manager.startTask.bind(manager),
        updateTask: manager.updateTask.bind(manager),
        finishTask: manager.finishTask.bind(manager),
        runWithTask: manager.runWithTask.bind(manager),
    };
};

export const ensureProgressOverlayBridge = (): void => {
    if (typeof window === "undefined") {
        return;
    }
    window.__CIALLI_PROGRESS_OVERLAY__ = getProgressOverlayApi();
};
