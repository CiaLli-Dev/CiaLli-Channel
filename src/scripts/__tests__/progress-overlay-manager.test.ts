import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeClassList {
    private readonly values = new Set<string>();

    add(...tokens: string[]): void {
        tokens.forEach((token) => {
            if (token) {
                this.values.add(token);
            }
        });
    }

    remove(...tokens: string[]): void {
        tokens.forEach((token) => {
            this.values.delete(token);
        });
    }

    toggle(token: string, force?: boolean): boolean {
        if (force === true) {
            this.values.add(token);
            return true;
        }
        if (force === false) {
            this.values.delete(token);
            return false;
        }
        if (this.values.has(token)) {
            this.values.delete(token);
            return false;
        }
        this.values.add(token);
        return true;
    }

    contains(token: string): boolean {
        return this.values.has(token);
    }
}

class FakeElement {
    readonly tagName: string;

    className = "";

    hidden = false;

    textContent = "";

    readonly style: Record<string, string> = {};

    readonly classList = new FakeClassList();

    readonly children: FakeElement[] = [];

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
    }

    appendChild(child: FakeElement): FakeElement {
        this.children.push(child);
        return child;
    }
}

type FakeDocument = {
    body: FakeElement;
    createElement: (tagName: string) => FakeElement;
};

const createFakeDom = (): FakeDocument => {
    const body = new FakeElement("body");
    return {
        body,
        createElement: (tagName: string) => new FakeElement(tagName),
    };
};

const getOverlayParts = (doc: FakeDocument) => {
    const overlay = doc.body.children[0];
    const card = overlay?.children[0];
    const title = card?.children[0];
    const text = card?.children[1];
    const track = card?.children[2];
    const fill = track?.children[0];
    const percent = card?.children[3];
    return {
        overlay,
        title,
        text,
        track,
        fill,
        percent,
    };
};

describe("progress-overlay-manager", () => {
    let fakeDocument: FakeDocument;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        fakeDocument = createFakeDom();
        vi.stubGlobal("document", fakeDocument as unknown as Document);
        vi.stubGlobal("window", {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis),
        } as unknown as Window & typeof globalThis);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("300ms 内完成时不展示 overlay", async () => {
        const { startTask, finishTask } =
            await import("@/scripts/progress-overlay-manager");
        const handle = startTask({
            title: "正在保存",
            delayMs: 300,
        });
        finishTask(handle);
        vi.advanceTimersByTime(500);
        expect(fakeDocument.body.children).toHaveLength(0);
        expect(
            fakeDocument.body.classList.contains("dc-progress-overlay-lock"),
        ).toBe(false);
    });

    it("超过 300ms 展示 overlay 并锁定滚动", async () => {
        const { startTask } =
            await import("@/scripts/progress-overlay-manager");
        startTask({
            title: "正在发布",
            text: "请稍候",
            mode: "indeterminate",
            delayMs: 300,
        });
        vi.advanceTimersByTime(299);
        expect(fakeDocument.body.children).toHaveLength(0);
        vi.advanceTimersByTime(1);
        const { overlay, title, text } = getOverlayParts(fakeDocument);
        expect(overlay).toBeDefined();
        expect(overlay?.hidden).toBe(false);
        expect(title?.textContent).toBe("正在发布");
        expect(text?.textContent).toBe("请稍候");
        expect(
            fakeDocument.body.classList.contains("dc-progress-overlay-lock"),
        ).toBe(true);
    });

    it("并发任务只显示最新活跃任务，结束后回退到上一任务", async () => {
        const { finishTask, startTask } =
            await import("@/scripts/progress-overlay-manager");
        const taskA = startTask({
            title: "任务 A",
            text: "A 阶段",
            delayMs: 0,
        });
        const taskB = startTask({
            title: "任务 B",
            text: "B 阶段",
            delayMs: 0,
        });
        let parts = getOverlayParts(fakeDocument);
        expect(parts.title?.textContent).toBe("任务 B");
        expect(parts.text?.textContent).toBe("B 阶段");

        finishTask(taskB);
        parts = getOverlayParts(fakeDocument);
        expect(parts.title?.textContent).toBe("任务 A");
        expect(parts.text?.textContent).toBe("A 阶段");

        finishTask(taskA);
        parts = getOverlayParts(fakeDocument);
        expect(parts.overlay?.hidden).toBe(true);
        expect(
            fakeDocument.body.classList.contains("dc-progress-overlay-lock"),
        ).toBe(false);
    });

    it("determinate 与 indeterminate 模式渲染正确", async () => {
        const { startTask, updateTask } =
            await import("@/scripts/progress-overlay-manager");
        const handle = startTask({
            title: "上传中",
            mode: "determinate",
            percent: 10,
            delayMs: 0,
        });

        let parts = getOverlayParts(fakeDocument);
        expect(parts.track?.classList.contains("is-indeterminate")).toBe(false);
        expect(parts.fill?.style.width).toBe("10%");
        expect(parts.percent?.textContent).toBe("10%");
        expect(parts.percent?.classList.contains("hidden")).toBe(false);

        updateTask(handle, {
            percent: 80,
        });
        parts = getOverlayParts(fakeDocument);
        expect(parts.fill?.style.width).toBe("80%");
        expect(parts.percent?.textContent).toBe("80%");

        updateTask(handle, {
            mode: "indeterminate",
            text: "正在提交",
        });
        parts = getOverlayParts(fakeDocument);
        expect(parts.track?.classList.contains("is-indeterminate")).toBe(true);
        expect(parts.fill?.style.width).toBe("40%");
        expect(parts.percent?.classList.contains("hidden")).toBe(true);
    });
});
