import { getRunningDays } from "@/utils/running-days";
import { setupPageInit } from "@/utils/page-init";

type RunningDaysRuntimeWindow = Window &
    typeof globalThis & {
        __runningDaysIntervalId?: number;
    };

const RUNNING_DAYS_SELECTOR = '[data-stat-id="running-days"]';
const ONE_HOUR_MS = 60 * 60 * 1000;

function readSiteStartDateFromRuntime(): string | null {
    const raw = window.__CIALLI_RUNTIME_SETTINGS__?.settings.site.siteStartDate;
    if (typeof raw !== "string") {
        return null;
    }
    const normalized = raw.trim();
    return normalized || null;
}

function updateRunningDaysDisplay(): void {
    const targets = document.querySelectorAll<HTMLElement>(
        RUNNING_DAYS_SELECTOR,
    );
    if (targets.length === 0) {
        return;
    }

    const runningDays = getRunningDays(readSiteStartDateFromRuntime());
    const displayValue = String(runningDays);
    targets.forEach((target) => {
        target.textContent = displayValue;
    });
}

function ensureRunningDaysTimer(): void {
    const runtimeWindow = window as RunningDaysRuntimeWindow;
    if (typeof runtimeWindow.__runningDaysIntervalId === "number") {
        return;
    }

    // 全局只保留一个定时器，避免 Swup 切页时重复注册。
    runtimeWindow.__runningDaysIntervalId = window.setInterval(() => {
        updateRunningDaysDisplay();
    }, ONE_HOUR_MS);
}

export function initRunningDaysRuntime(): void {
    setupPageInit({
        key: "running-days-runtime",
        init: () => {
            updateRunningDaysDisplay();
            ensureRunningDaysTimer();
        },
        runOnPageShow: true,
        stages: ["page-load"],
    });
}
