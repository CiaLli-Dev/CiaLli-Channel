import {
    finishTask,
    startTask,
    updateTask,
    type ProgressTaskHandle,
} from "@/scripts/progress-overlay-manager";

/**
 * 兼容旧接口：内部已切换为全局进度覆盖层管理器。
 */
export class SaveProgressOverlay {
    private handle: ProgressTaskHandle | null = null;

    show(title?: string): void {
        if (this.handle !== null) {
            finishTask(this.handle);
        }
        this.handle = startTask({
            title: title ?? "正在保存",
            mode: "determinate",
            percent: 0,
        });
    }

    update(percent: number, text: string): void {
        if (this.handle === null) {
            this.show();
        }
        if (this.handle === null) {
            return;
        }
        updateTask(this.handle, {
            mode: "determinate",
            percent,
            text,
        });
    }

    hide(): void {
        if (this.handle === null) {
            return;
        }
        finishTask(this.handle);
        this.handle = null;
    }

    destroy(): void {
        this.hide();
    }
}
