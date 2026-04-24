import { setupPageInit } from "@/utils/page-init";

type AiSummaryStatus =
    | "pending"
    | "processing"
    | "succeeded"
    | "failed"
    | "canceled"
    | "skipped";

type PublicArticleSummaryPollItem = {
    summary?: unknown;
    summary_source?: unknown;
    ai_summary_status?: unknown;
};

type PublicArticleSummaryPollResponse = {
    ok?: unknown;
    item?: PublicArticleSummaryPollItem;
};

const ROOT_SELECTOR = "[data-ai-summary-root]";
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = 120_000;
const TERMINAL_FAILURE_STATUSES = new Set<AiSummaryStatus>([
    "failed",
    "canceled",
    "skipped",
]);

let pollTimer: number | null = null;
let visibilityListener: (() => void) | null = null;

function normalizeStatus(value: unknown): AiSummaryStatus | null {
    if (
        value === "pending" ||
        value === "processing" ||
        value === "succeeded" ||
        value === "failed" ||
        value === "canceled" ||
        value === "skipped"
    ) {
        return value;
    }
    return null;
}

function readPollItem(payload: unknown): PublicArticleSummaryPollItem | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const response = payload as PublicArticleSummaryPollResponse;
    if (
        response.ok !== true ||
        !response.item ||
        typeof response.item !== "object"
    ) {
        return null;
    }

    return response.item;
}

function appendPollCacheBuster(rawUrl: string): string {
    const url = new URL(rawUrl, window.location.origin);
    url.searchParams.set("poll_ts", String(Date.now()));
    return `${url.pathname}${url.search}`;
}

function getRequiredRootElements(root: HTMLElement): {
    skeletonCard: HTMLElement;
    finalCard: HTMLElement;
    finalText: HTMLElement;
    hint: HTMLElement;
    pillLabel: HTMLElement;
} | null {
    const skeletonCard = root.querySelector<HTMLElement>(
        "[data-ai-summary-skeleton-card]",
    );
    const finalCard = root.querySelector<HTMLElement>(
        "[data-ai-summary-final-card]",
    );
    const finalText = root.querySelector<HTMLElement>(
        "[data-ai-summary-final-text]",
    );
    const hint = root.querySelector<HTMLElement>("[data-ai-summary-hint]");
    const pillLabel = root.querySelector<HTMLElement>(
        "[data-ai-summary-pill-label]",
    );

    if (!skeletonCard || !finalCard || !finalText || !hint || !pillLabel) {
        return null;
    }

    return { skeletonCard, finalCard, finalText, hint, pillLabel };
}

function setGeneratingState(root: HTMLElement, status: AiSummaryStatus): void {
    const elements = getRequiredRootElements(root);
    if (!elements) {
        return;
    }

    root.dataset.aiSummaryStatus = status;
    elements.skeletonCard.removeAttribute("data-ai-summary-terminal");
    elements.skeletonCard.classList.remove("hidden");
    elements.skeletonCard.hidden = false;
    elements.finalCard.classList.add("hidden");
    elements.finalCard.hidden = true;
    elements.hint.textContent =
        status === "processing"
            ? root.dataset.aiSummaryGeneratingHint || ""
            : root.dataset.aiSummaryQueuedHint || "";
    elements.pillLabel.textContent =
        status === "processing"
            ? root.dataset.aiSummaryGeneratingLabel || ""
            : root.dataset.aiSummaryQueuedLabel || "";
}

function showFinalSummary(root: HTMLElement, summary: string): void {
    const elements = getRequiredRootElements(root);
    if (!elements) {
        return;
    }

    root.dataset.aiSummaryStatus = "succeeded";
    elements.finalText.textContent = summary;
    elements.finalCard.classList.remove("hidden");
    elements.finalCard.hidden = false;
    elements.skeletonCard.classList.add("hidden");
    elements.skeletonCard.hidden = true;
}

function showTerminalFailure(
    root: HTMLElement,
    reason: "failed" | "timeout",
): void {
    const elements = getRequiredRootElements(root);
    if (!elements) {
        return;
    }

    root.dataset.aiSummaryStatus = reason;
    elements.skeletonCard.setAttribute("data-ai-summary-terminal", reason);
    elements.skeletonCard.classList.remove("hidden");
    elements.skeletonCard.hidden = false;
    elements.finalCard.classList.add("hidden");
    elements.finalCard.hidden = true;
    elements.hint.textContent =
        reason === "timeout"
            ? root.dataset.aiSummaryTimeoutHint || ""
            : root.dataset.aiSummaryFailedHint || "";
    elements.pillLabel.textContent =
        reason === "timeout"
            ? root.dataset.aiSummaryTimeoutLabel || ""
            : root.dataset.aiSummaryFailedLabel || "";
}

async function pollSummary(root: HTMLElement): Promise<"done" | "continue"> {
    const rawPollUrl = String(root.dataset.aiSummaryPollUrl || "").trim();
    if (!rawPollUrl) {
        return "done";
    }

    const response = await fetch(appendPollCacheBuster(rawPollUrl), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        return "continue";
    }

    const payload = await response.json().catch(() => null);
    const item = readPollItem(payload);
    if (!item) {
        return "continue";
    }

    const status = normalizeStatus(item.ai_summary_status);
    if (status === "pending" || status === "processing") {
        setGeneratingState(root, status);
        return "continue";
    }
    if (status && TERMINAL_FAILURE_STATUSES.has(status)) {
        showTerminalFailure(root, "failed");
        return "done";
    }

    const summary = String(item.summary || "").trim();
    const summarySource = String(item.summary_source || "");
    if (summary && summarySource === "ai") {
        showFinalSummary(root, summary);
        return "done";
    }

    return "continue";
}

function clearPolling(): void {
    if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
    }
    if (visibilityListener) {
        document.removeEventListener("visibilitychange", visibilityListener);
        visibilityListener = null;
    }
}

function initAiSummaryPolling(): void {
    clearPolling();

    const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
    const initialStatus = normalizeStatus(root?.dataset.aiSummaryStatus);
    if (
        !root ||
        (initialStatus !== "pending" && initialStatus !== "processing")
    ) {
        return;
    }

    const startedAt = Date.now();
    let polling = false;

    const scheduleNextPoll = (delay = POLL_INTERVAL_MS) => {
        if (pollTimer !== null) {
            window.clearTimeout(pollTimer);
        }
        pollTimer = window.setTimeout(() => {
            void runPoll();
        }, delay);
    };

    const runPoll = async (): Promise<void> => {
        if (polling) {
            return;
        }
        if (document.hidden) {
            scheduleNextPoll();
            return;
        }
        if (Date.now() - startedAt >= MAX_POLL_MS) {
            showTerminalFailure(root, "timeout");
            clearPolling();
            return;
        }

        polling = true;
        try {
            const result = await pollSummary(root);
            if (result === "done") {
                clearPolling();
                return;
            }
        } catch (error) {
            console.warn("[article-ai-summary] summary polling failed", error);
        } finally {
            polling = false;
        }

        scheduleNextPoll();
    };

    visibilityListener = () => {
        if (!document.hidden) {
            void runPoll();
        }
    };
    document.addEventListener("visibilitychange", visibilityListener);
    void runPoll();
}

setupPageInit({
    key: "article-ai-summary-card",
    init: initAiSummaryPolling,
    cleanup: clearPolling,
    runOnPageShow: true,
    stages: ["navigation-settled"],
});
