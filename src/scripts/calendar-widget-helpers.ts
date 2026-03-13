/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
/**
 * Calendar widget helpers - 从 calendar-widget.ts 中分离出来的辅助函数。
 * 这些函数通过 CalendarContext 对象访问共享状态，避免了大型闭包。
 */

import type {
    CalendarPost,
    CalendarConfig,
    CalendarRuntimeWindow,
} from "@/scripts/calendar-widget";
import {
    buildMonthGridHtml,
    buildMonthPickerHtml,
    buildYearPickerHtml,
    getMonthCacheKey,
    getMonthLabel,
    getYearLabel,
    processPostsData,
} from "@/scripts/calendar-widget";

type FilterType = "day" | "month" | "year";

type ActiveFilter = {
    type: FilterType;
    key: string;
    posts: CalendarPost[];
    label: string;
} | null;

type CalendarDom = {
    toggleBtn: HTMLElement | null;
    toggleIcon: HTMLElement | null;
    body: HTMLElement | null;
    loading: HTMLElement | null;
    error: HTMLElement | null;
    errorText: HTMLElement | null;
    retryBtn: HTMLElement | null;
    content: HTMLElement | null;
    yearBtn: HTMLElement | null;
    monthBtn: HTMLElement | null;
    prevBtn: HTMLElement | null;
    nextBtn: HTMLElement | null;
    backTodayBtn: HTMLElement | null;
    calendarView: HTMLElement | null;
    selectionPanel: HTMLElement | null;
    selectionContent: HTMLElement | null;
    grid: HTMLElement | null;
};

export type CalendarContext = {
    config: CalendarConfig;
    dom: CalendarDom;
    signal: AbortSignal;
    runtimeWindow: CalendarRuntimeWindow;
    todayYear: number;
    todayMonth: number;
    todayDate: number;
    allPostsData: CalendarPost[];
    postDateMap: Record<string, CalendarPost[]>;
    postsByMonth: Record<string, CalendarPost[]>;
    postsByYear: Record<string, CalendarPost[]>;
    stats: {
        hasPostInYear: Record<string, boolean>;
        hasPostInMonth: Record<string, boolean>;
        minYear: number;
        maxYear: number;
    };
    monthGridCache: Map<string, string>;
    hasLoadedData: boolean;
    isLoadingData: boolean;
    loadError: string | null;
    dataLoadPromise: Promise<boolean> | null;
    currentYear: number;
    currentMonth: number;
    selectedDateKey: string | null;
    activeFilter: ActiveFilter;
    currentView: string;
    isExpanded: boolean;
};

export function renderHeaderState(ctx: CalendarContext): void {
    const { dom, isExpanded } = ctx;
    if (dom.toggleBtn) {
        dom.toggleBtn.setAttribute("aria-expanded", String(isExpanded));
    }
    dom.toggleIcon?.classList.toggle("rotate-180", isExpanded);
    dom.body?.classList.toggle("expanded", isExpanded);
}

export function renderLoadState(ctx: CalendarContext): void {
    const { dom, isExpanded, isLoadingData, hasLoadedData, loadError } = ctx;
    const showLoading = isExpanded && isLoadingData;
    const showError = isExpanded && !isLoadingData && Boolean(loadError);
    const showContent = isExpanded && hasLoadedData && !showError;

    dom.loading?.classList.toggle("hidden", !showLoading);
    dom.error?.classList.toggle("hidden", !showError);
    dom.content?.classList.toggle("hidden", !showContent);

    if (dom.errorText && loadError) {
        dom.errorText.textContent = loadError;
    }
}

export function updateHeaderControls(ctx: CalendarContext): void {
    const {
        dom,
        currentYear,
        currentMonth,
        config,
        todayYear,
        todayMonth,
        selectedDateKey,
        activeFilter,
    } = ctx;
    if (dom.yearBtn) {
        dom.yearBtn.textContent = `${currentYear}${config.yearSuffix}`;
    }
    if (dom.monthBtn) {
        dom.monthBtn.textContent = config.monthNames[currentMonth] ?? "";
    }

    const isCurrentRealMonth =
        currentYear === todayYear && currentMonth === todayMonth;
    const shouldShowReset =
        !isCurrentRealMonth ||
        selectedDateKey !== null ||
        activeFilter !== null;

    if (shouldShowReset) {
        dom.backTodayBtn?.classList.remove("invisible");
    } else {
        dom.backTodayBtn?.classList.add("invisible");
    }
}

export function renderDayGridIfNeeded(
    ctx: CalendarContext,
    forceRebuild = false,
): void {
    const {
        dom,
        currentYear,
        currentMonth,
        postDateMap,
        todayYear,
        todayMonth,
        todayDate,
        monthGridCache,
    } = ctx;
    if (!dom.grid) return;
    const monthKey = getMonthCacheKey(currentYear, currentMonth);
    const renderedMonthKey = dom.grid.getAttribute("data-rendered-month");

    if (!forceRebuild && renderedMonthKey === monthKey) return;

    let html = monthGridCache.get(monthKey);
    if (!html) {
        html = buildMonthGridHtml(
            currentYear,
            currentMonth,
            postDateMap,
            todayYear,
            todayMonth,
            todayDate,
        );
        monthGridCache.set(monthKey, html);
    }

    dom.grid.innerHTML = html;
    dom.grid.setAttribute("data-rendered-month", monthKey);
}

export function syncSelectedDayState(ctx: CalendarContext): void {
    const { dom, selectedDateKey } = ctx;
    if (!dom.grid) return;
    dom.grid
        .querySelectorAll(".calendar-day.is-selected")
        .forEach((cell) => cell.classList.remove("is-selected"));

    if (!selectedDateKey) return;
    const selectedCell = dom.grid.querySelector(
        `.calendar-day[data-date="${selectedDateKey}"]`,
    );
    selectedCell?.classList.add("is-selected");
}

export function renderCalendar(ctx: CalendarContext, forceGrid = false): void {
    renderHeaderState(ctx);
    updateHeaderControls(ctx);

    if (!ctx.hasLoadedData) {
        renderLoadState(ctx);
        return;
    }

    renderDayGridIfNeeded(ctx, forceGrid);
    syncSelectedDayState(ctx);
    renderLoadState(ctx);
}

export function applyFilter(
    ctx: CalendarContext,
    type: FilterType,
    key: string,
    posts: CalendarPost[],
    label: string,
): void {
    ctx.activeFilter = { type, key, posts, label };
    if (type !== "day") {
        ctx.selectedDateKey = null;
    }
    window.dispatchEvent(
        new CustomEvent("calendarFilterChange", {
            detail: { type, key, posts, label },
        }),
    );
}

export function clearFilter(ctx: CalendarContext): void {
    ctx.activeFilter = null;
    ctx.selectedDateKey = null;
    window.dispatchEvent(new CustomEvent("calendarFilterClear"));
}

export function showMonthPicker(ctx: CalendarContext): void {
    const { dom, hasLoadedData, currentMonth, currentYear, config, stats } =
        ctx;
    if (!hasLoadedData || !dom.selectionPanel || !dom.selectionContent) return;
    ctx.currentView = "month";
    updateHeaderControls(ctx);
    dom.selectionPanel.classList.add("flex", "flex-col");
    dom.selectionPanel.classList.remove("hidden");
    requestAnimationFrame(() => {
        dom.selectionPanel?.classList.remove("opacity-0");
    });

    dom.selectionContent.className =
        "w-full h-full p-4 grid grid-cols-3 gap-3 content-center justify-items-end";
    dom.selectionContent.innerHTML = buildMonthPickerHtml(
        config.monthNames,
        currentMonth,
        currentYear,
        stats,
    );
}

export function showYearPicker(ctx: CalendarContext): void {
    const { dom, hasLoadedData, currentYear, stats } = ctx;
    if (!hasLoadedData || !dom.selectionPanel || !dom.selectionContent) return;
    ctx.currentView = "year";
    updateHeaderControls(ctx);
    dom.selectionPanel.classList.add("flex", "flex-col");
    dom.selectionPanel.classList.remove("hidden");
    requestAnimationFrame(() => {
        dom.selectionPanel?.classList.remove("opacity-0");
    });
    dom.selectionContent.className =
        "w-full h-full p-2 grid grid-cols-4 gap-2 content-start overflow-y-auto";

    dom.selectionContent.innerHTML = buildYearPickerHtml(stats, currentYear);

    requestAnimationFrame(() => {
        const el = document.getElementById(`year-${currentYear}`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
}

export function closeSelectionPanel(
    ctx: CalendarContext,
    immediate = false,
): void {
    const { dom, signal, hasLoadedData, isExpanded } = ctx;
    if (!dom.selectionPanel) return;
    if (dom.selectionPanel.classList.contains("hidden")) {
        ctx.currentView = "day";
        return;
    }

    const finish = (): void => {
        dom.selectionPanel?.classList.remove("flex", "flex-col");
        dom.selectionPanel?.classList.add("hidden", "opacity-0");
        ctx.currentView = "day";
        if (isExpanded && hasLoadedData) {
            renderCalendar(ctx);
        }
    };

    if (immediate) {
        finish();
        return;
    }

    let closed = false;
    const finishOnce = (): void => {
        if (closed) return;
        closed = true;
        finish();
    };

    dom.selectionPanel.addEventListener("transitionend", finishOnce, {
        once: true,
        signal,
    });
    requestAnimationFrame(() => {
        dom.selectionPanel?.classList.add("opacity-0");
    });
    window.setTimeout(finishOnce, 240);
}

export function resetPostIndexes(ctx: CalendarContext): void {
    const {
        postDateMap,
        postsByMonth,
        postsByYear,
        stats,
        todayYear,
        monthGridCache,
    } = ctx;
    for (const key of Object.keys(postDateMap)) delete postDateMap[key];
    for (const key of Object.keys(postsByMonth)) delete postsByMonth[key];
    for (const key of Object.keys(postsByYear)) delete postsByYear[key];
    stats.hasPostInYear = Object.create(null) as Record<string, boolean>;
    stats.hasPostInMonth = Object.create(null) as Record<string, boolean>;
    stats.minYear = todayYear;
    stats.maxYear = todayYear + 5;
    monthGridCache.clear();
}

export async function fetchCalendarData(
    ctx: CalendarContext,
): Promise<boolean> {
    if (ctx.hasLoadedData) return true;
    if (ctx.dataLoadPromise) return ctx.dataLoadPromise;

    ctx.dataLoadPromise = (async (): Promise<boolean> => {
        ctx.isLoadingData = true;
        ctx.loadError = null;
        renderLoadState(ctx);

        try {
            let data = ctx.runtimeWindow.__calendarWidgetDataCache?.posts;

            if (!Array.isArray(data)) {
                const res = await fetch("/api/calendar-data.json");
                if (!res.ok) {
                    throw new Error(
                        `calendar-data request failed: ${res.status}`,
                    );
                }
                data = (await res.json()) as CalendarPost[];
                if (!Array.isArray(data)) {
                    throw new Error("calendar-data payload is not an array");
                }
                ctx.runtimeWindow.__calendarWidgetDataCache = { posts: data };
            }

            ctx.allPostsData = data;
            resetPostIndexes(ctx);
            processPostsData(
                ctx.allPostsData,
                ctx.postDateMap,
                ctx.postsByMonth,
                ctx.postsByYear,
                ctx.stats,
            );

            const path = window.location.pathname;
            if (ctx.allPostsData.length > 0) {
                const decodedPath = decodeURIComponent(path);
                const normalizedPath = decodedPath.endsWith("/")
                    ? decodedPath.slice(0, -1)
                    : decodedPath;
                const matchedPost = ctx.allPostsData.find((post) =>
                    normalizedPath.endsWith(`/${post.id}`),
                );
                if (matchedPost) {
                    const [y, m] = matchedPost.date.split("-");
                    ctx.currentYear = parseInt(y);
                    ctx.currentMonth = parseInt(m) - 1;
                }
            }

            ctx.hasLoadedData = true;
            renderCalendar(ctx, true);
            return true;
        } catch (error) {
            ctx.loadError = ctx.config.isChinese
                ? "加载日历失败，请重试。"
                : "Failed to load calendar. Please retry.";
            console.error("[calendar] failed to fetch calendar data:", error);
            return false;
        } finally {
            ctx.isLoadingData = false;
            renderLoadState(ctx);
            ctx.dataLoadPromise = null;
        }
    })();

    return ctx.dataLoadPromise;
}

export async function toggleExpand(ctx: CalendarContext): Promise<void> {
    ctx.isExpanded = !ctx.isExpanded;
    renderHeaderState(ctx);
    renderLoadState(ctx);

    if (!ctx.isExpanded) {
        if (ctx.currentView !== "day") {
            closeSelectionPanel(ctx, true);
        }
        return;
    }

    if (!ctx.hasLoadedData) {
        await fetchCalendarData(ctx);
        return;
    }

    renderCalendar(ctx);
}

export function handleGridClick(ctx: CalendarContext, e: MouseEvent): void {
    if (!ctx.hasLoadedData) return;
    const cell = (e.target as Element).closest(".calendar-day");
    if (!cell) return;
    const dateKey = cell.getAttribute("data-date");
    if (!dateKey) return;
    const posts = ctx.postDateMap[dateKey] ?? [];

    if (posts.length === 0) {
        clearFilter(ctx);
        renderCalendar(ctx);
        return;
    }

    if (ctx.activeFilter?.type === "day" && ctx.selectedDateKey === dateKey) {
        clearFilter(ctx);
    } else {
        ctx.selectedDateKey = dateKey;
        applyFilter(ctx, "day", dateKey, posts, dateKey);
    }

    renderCalendar(ctx);
}

export function handleSelectionContentClick(
    ctx: CalendarContext,
    e: MouseEvent,
): void {
    if (!ctx.hasLoadedData) return;
    const monthItem = (e.target as Element).closest(".month-item");
    const yearItem = (e.target as Element).closest(".year-item");

    if (monthItem) {
        e.stopPropagation();
        ctx.currentMonth = parseInt(
            monthItem.getAttribute("data-month") ?? "0",
        );
        const monthPosts =
            ctx.postsByMonth[`${ctx.currentYear}-${ctx.currentMonth}`] ?? [];
        if (monthPosts.length > 0) {
            const filterKey = `${ctx.currentYear}-${String(ctx.currentMonth + 1).padStart(2, "0")}`;
            applyFilter(
                ctx,
                "month",
                filterKey,
                monthPosts,
                getMonthLabel(
                    ctx.currentYear,
                    ctx.currentMonth,
                    ctx.config.monthNames,
                    ctx.config.yearSuffix,
                ),
            );
        } else {
            clearFilter(ctx);
        }
        closeSelectionPanel(ctx);
    } else if (yearItem) {
        e.stopPropagation();
        ctx.currentYear = parseInt(yearItem.getAttribute("data-year") ?? "0");
        const yearPosts = ctx.postsByYear[String(ctx.currentYear)] ?? [];
        if (yearPosts.length > 0) {
            applyFilter(
                ctx,
                "year",
                String(ctx.currentYear),
                yearPosts,
                getYearLabel(ctx.currentYear, ctx.config.yearSuffix),
            );
        } else {
            clearFilter(ctx);
        }
        closeSelectionPanel(ctx);
    }
}

export function setupEventListeners(ctx: CalendarContext): void {
    const { dom, signal } = ctx;

    dom.toggleBtn?.addEventListener(
        "click",
        () => {
            void toggleExpand(ctx);
        },
        { signal },
    );
    dom.retryBtn?.addEventListener(
        "click",
        () => {
            void fetchCalendarData(ctx);
        },
        { signal },
    );

    dom.yearBtn?.addEventListener(
        "click",
        (e) => {
            e.stopPropagation();
            if (ctx.currentView === "year") closeSelectionPanel(ctx);
            else showYearPicker(ctx);
        },
        { signal },
    );

    dom.monthBtn?.addEventListener(
        "click",
        (e) => {
            e.stopPropagation();
            if (ctx.currentView === "month") closeSelectionPanel(ctx);
            else showMonthPicker(ctx);
        },
        { signal },
    );

    dom.prevBtn?.addEventListener(
        "click",
        () => {
            if (!ctx.hasLoadedData) return;
            if (ctx.currentView !== "day") closeSelectionPanel(ctx);
            if (ctx.activeFilter || ctx.selectedDateKey) clearFilter(ctx);
            ctx.currentMonth--;
            if (ctx.currentMonth < 0) {
                ctx.currentMonth = 11;
                ctx.currentYear--;
            }
            renderCalendar(ctx);
        },
        { signal },
    );

    dom.nextBtn?.addEventListener(
        "click",
        () => {
            if (!ctx.hasLoadedData) return;
            if (ctx.currentView !== "day") closeSelectionPanel(ctx);
            if (ctx.activeFilter || ctx.selectedDateKey) clearFilter(ctx);
            ctx.currentMonth++;
            if (ctx.currentMonth > 11) {
                ctx.currentMonth = 0;
                ctx.currentYear++;
            }
            renderCalendar(ctx);
        },
        { signal },
    );

    dom.backTodayBtn?.addEventListener(
        "click",
        () => {
            if (!ctx.hasLoadedData) return;
            ctx.currentYear = ctx.todayYear;
            ctx.currentMonth = ctx.todayMonth;
            clearFilter(ctx);
            if (ctx.currentView !== "day") closeSelectionPanel(ctx);
            else renderCalendar(ctx);
        },
        { signal },
    );

    dom.grid?.addEventListener("click", (e) => handleGridClick(ctx, e), {
        signal,
    });
    dom.selectionContent?.addEventListener(
        "click",
        (e) => handleSelectionContentClick(ctx, e),
        { signal },
    );

    document.addEventListener(
        "click",
        (e) => {
            if (ctx.currentView === "day") return;
            const widget = document.getElementById("calendar-widget");
            if (widget && !widget.contains(e.target as Node))
                closeSelectionPanel(ctx);
        },
        { signal },
    );

    window.addEventListener(
        "calendarFilterClear",
        () => {
            if (ctx.activeFilter === null && ctx.selectedDateKey === null)
                return;
            ctx.activeFilter = null;
            ctx.selectedDateKey = null;
            if (ctx.hasLoadedData) renderCalendar(ctx);
        },
        { signal },
    );
}
