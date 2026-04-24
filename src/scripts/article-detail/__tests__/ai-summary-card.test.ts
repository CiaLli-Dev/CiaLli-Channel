import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PageInitWindow = Window & {
    __pageInitRegistry?: Set<string>;
    __pageInitLastRunByKey?: Map<string, string>;
};

function renderAiSummaryRoot(options?: {
    initialStatus?: string;
    finalHidden?: boolean;
    summaryText?: string;
}): HTMLElement {
    document.body.innerHTML = `
        <section
            data-ai-summary-root
            data-ai-summary-status="${options?.initialStatus ?? "pending"}"
            data-ai-summary-poll-url="/api/v1/public/articles/article-1?bypass_cache=1"
            data-ai-summary-generating-label="生成中"
            data-ai-summary-queued-label="排队中"
            data-ai-summary-failed-label="失败"
            data-ai-summary-timeout-label="仍在生成"
            data-ai-summary-generating-hint="正在生成新的摘要"
            data-ai-summary-queued-hint="摘要任务已排队"
            data-ai-summary-failed-hint="摘要生成失败"
            data-ai-summary-timeout-hint="摘要生成时间较长，请稍后刷新查看"
        >
            <aside data-ai-summary-skeleton-card>
                <p data-ai-summary-hint>摘要任务已排队</p>
                <span data-ai-summary-pill-label>排队中</span>
            </aside>
            <aside
                data-ai-summary-final-card
                ${options?.finalHidden === true ? 'hidden class="hidden"' : ""}
            >
                <p data-ai-summary-final-text>${options?.summaryText ?? "旧 AI 摘要"}</p>
            </aside>
        </section>
    `;

    const root = document.querySelector<HTMLElement>("[data-ai-summary-root]");
    if (!root) {
        throw new Error("AI summary root not found");
    }
    return root;
}

async function initModuleAndRunInitialPoll(): Promise<void> {
    await import("@/scripts/article-detail/ai-summary-card");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    document.dispatchEvent(new Event("cialli:navigation:settled"));
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
}

describe("article-detail ai-summary-card", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        const pageWindow = window as PageInitWindow;
        pageWindow.__pageInitRegistry = undefined;
        pageWindow.__pageInitLastRunByKey = undefined;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("轮询返回 pending 时会优先显示生成态并隐藏旧 AI 摘要", async () => {
        const root = renderAiSummaryRoot({
            initialStatus: "pending",
            finalHidden: false,
            summaryText: "旧 AI 摘要",
        });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                ok: true,
                item: {
                    summary: "旧 AI 摘要",
                    summary_source: "ai",
                    ai_summary_status: "pending",
                },
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await initModuleAndRunInitialPoll();

        const skeletonCard = root.querySelector<HTMLElement>(
            "[data-ai-summary-skeleton-card]",
        );
        const finalCard = root.querySelector<HTMLElement>(
            "[data-ai-summary-final-card]",
        );
        const hint = root.querySelector<HTMLElement>("[data-ai-summary-hint]");
        const pillLabel = root.querySelector<HTMLElement>(
            "[data-ai-summary-pill-label]",
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(root.dataset.aiSummaryStatus).toBe("pending");
        expect(skeletonCard?.hidden).toBe(false);
        expect(skeletonCard?.classList.contains("hidden")).toBe(false);
        expect(finalCard?.hidden).toBe(true);
        expect(finalCard?.classList.contains("hidden")).toBe(true);
        expect(hint?.textContent).toBe("摘要任务已排队");
        expect(pillLabel?.textContent).toBe("排队中");
    });

    it("轮询返回 succeeded 时会切换到最新 AI 摘要", async () => {
        const root = renderAiSummaryRoot({
            initialStatus: "processing",
            finalHidden: true,
            summaryText: "",
        });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                ok: true,
                item: {
                    summary: "这篇文章介绍了新的概要。",
                    summary_source: "ai",
                    ai_summary_status: "succeeded",
                },
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await initModuleAndRunInitialPoll();

        const skeletonCard = root.querySelector<HTMLElement>(
            "[data-ai-summary-skeleton-card]",
        );
        const finalCard = root.querySelector<HTMLElement>(
            "[data-ai-summary-final-card]",
        );
        const finalText = root.querySelector<HTMLElement>(
            "[data-ai-summary-final-text]",
        );

        expect(root.dataset.aiSummaryStatus).toBe("succeeded");
        expect(skeletonCard?.hidden).toBe(true);
        expect(finalCard?.hidden).toBe(false);
        expect(finalText?.textContent).toBe("这篇文章介绍了新的概要。");
    });

    it("轮询返回失败终态时会展示失败提示且不保留旧摘要占位", async () => {
        const root = renderAiSummaryRoot({
            initialStatus: "processing",
            finalHidden: false,
            summaryText: "旧 AI 摘要",
        });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                ok: true,
                item: {
                    summary: "旧 AI 摘要",
                    summary_source: "ai",
                    ai_summary_status: "failed",
                },
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await initModuleAndRunInitialPoll();

        const skeletonCard = root.querySelector<HTMLElement>(
            "[data-ai-summary-skeleton-card]",
        );
        const finalCard = root.querySelector<HTMLElement>(
            "[data-ai-summary-final-card]",
        );
        const hint = root.querySelector<HTMLElement>("[data-ai-summary-hint]");
        const pillLabel = root.querySelector<HTMLElement>(
            "[data-ai-summary-pill-label]",
        );

        expect(root.dataset.aiSummaryStatus).toBe("failed");
        expect(skeletonCard?.getAttribute("data-ai-summary-terminal")).toBe(
            "failed",
        );
        expect(finalCard?.hidden).toBe(true);
        expect(hint?.textContent).toBe("摘要生成失败");
        expect(pillLabel?.textContent).toBe("失败");
    });

    it("轮询超时会展示等待文案而不是失败文案", async () => {
        const root = renderAiSummaryRoot({
            initialStatus: "processing",
            finalHidden: false,
            summaryText: "旧 AI 摘要",
        });
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    ok: true,
                    item: {
                        summary: "旧 AI 摘要",
                        summary_source: "ai",
                        ai_summary_status: "processing",
                    },
                }),
            }),
        );

        await initModuleAndRunInitialPoll();
        await vi.advanceTimersByTimeAsync(120_000);

        const hint = root.querySelector<HTMLElement>("[data-ai-summary-hint]");
        const pillLabel = root.querySelector<HTMLElement>(
            "[data-ai-summary-pill-label]",
        );
        const skeletonCard = root.querySelector<HTMLElement>(
            "[data-ai-summary-skeleton-card]",
        );

        expect(root.dataset.aiSummaryStatus).toBe("timeout");
        expect(skeletonCard?.getAttribute("data-ai-summary-terminal")).toBe(
            "timeout",
        );
        expect(hint?.textContent).toBe("摘要生成时间较长，请稍后刷新查看");
        expect(pillLabel?.textContent).toBe("仍在生成");
    });
});
