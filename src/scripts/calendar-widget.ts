/**
 * Calendar widget 运行时逻辑。
 *
 * 从 Calendar.astro 内联脚本中分离，使主文件保持在行数限制以内。
 * 由 Calendar.astro 的模块化 <script> 动态导入并执行。
 */

export type CalendarRuntimeWindow = Window &
    typeof globalThis & {
        __calendarWidgetCleanup?: (() => void) | undefined;
        __calendarWidgetDataCache?: { posts: CalendarPost[] } | undefined;
    };

export type CalendarPost = {
    id: string;
    date: string;
    [key: string]: unknown;
};

export type CalendarConfig = {
    monthNames: string[];
    yearSuffix: string;
    defaultExpanded: boolean;
    isChinese: boolean;
};

export function buildMonthGridHtml(
    year: number,
    monthIndex: number,
    postDateMap: Record<string, CalendarPost[]>,
    todayYear: number,
    todayMonth: number,
    todayDate: number,
): string {
    const firstDayOfMonth = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    let html = "";
    if (firstDayOfMonth > 0) {
        html += `<div class="aspect-square"></div>`.repeat(firstDayOfMonth);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const posts = postDateMap[dateKey] ?? [];
        const hasPost = posts.length > 0;
        const count = posts.length;
        const isToday =
            year === todayYear &&
            monthIndex === todayMonth &&
            day === todayDate;

        let stateClass = "calendar-day-default";
        if (isToday) {
            stateClass = "calendar-day-today";
        } else if (hasPost) {
            stateClass = "calendar-day-has-post";
        }

        html += `
			<div
				class="calendar-day aspect-square flex items-center justify-center rounded-md cursor-pointer relative transition-all duration-200 border border-transparent ${stateClass}"
				data-date="${dateKey}"
			>
				${day}
				<span class="calendar-day-dot absolute bottom-0 translate-y-0.5 w-1 h-1 rounded-full ${hasPost ? "opacity-100" : "opacity-0"}"></span>
				${hasPost && count > 1 ? `<span class="absolute top-0.5 right-0.5 text-[9px] opacity-70 scale-75">${count}</span>` : ""}
			</div>
		`;
    }

    return html;
}

export function processPostsData(
    posts: CalendarPost[],
    postDateMap: Record<string, CalendarPost[]>,
    postsByMonth: Record<string, CalendarPost[]>,
    postsByYear: Record<string, CalendarPost[]>,
    stats: {
        hasPostInYear: Record<string, boolean>;
        hasPostInMonth: Record<string, boolean>;
        minYear: number;
        maxYear: number;
    },
): void {
    if (!posts || posts.length === 0) {
        return;
    }
    posts.forEach((post) => {
        const [yStr, mStr] = post.date.split("-");
        const year = parseInt(yStr);
        const month = parseInt(mStr); // 1-12
        stats.hasPostInYear[year] = true;
        stats.hasPostInMonth[`${year}-${month}`] = true;

        if (year < stats.minYear) stats.minYear = year;
        if (year > stats.maxYear) stats.maxYear = year;

        const dateKey = post.date;
        const monthKey = `${year}-${month - 1}`; // JS Month is 0-11

        if (!postDateMap[dateKey]) postDateMap[dateKey] = [];
        postDateMap[dateKey].push(post);

        if (!postsByMonth[monthKey]) postsByMonth[monthKey] = [];
        postsByMonth[monthKey].push(post);

        const yearKey = String(year);
        if (!postsByYear[yearKey]) postsByYear[yearKey] = [];
        postsByYear[yearKey].push(post);
    });
}

export function getYearLabel(year: number, yearSuffix: string): string {
    const label = `${year}${yearSuffix}`.trim();
    return label || String(year);
}

export function getMonthLabel(
    year: number,
    monthIndex: number,
    monthNames: string[],
    yearSuffix: string,
): string {
    const yearLabel = getYearLabel(year, yearSuffix);
    if (yearSuffix.trim().length > 0) {
        return `${yearLabel}${monthNames[monthIndex]}`.trim();
    }
    return `${yearLabel} ${monthNames[monthIndex]}`.trim();
}

export function getMonthCacheKey(year: number, monthIndex: number): string {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function buildMonthPickerHtml(
    monthNames: string[],
    currentMonth: number,
    currentYear: number,
    stats: { hasPostInMonth: Record<string, boolean> },
): string {
    let html = "";
    monthNames.forEach((name, index) => {
        const isCurrentMonth = index === currentMonth;
        const hasPost = stats.hasPostInMonth[`${currentYear}-${index + 1}`];
        let cls =
            "month-item cursor-pointer rounded-lg flex flex-col items-center justify-center p-2 transition-all hover:bg-(--btn-plain-bg-hover) relative border border-transparent";
        if (isCurrentMonth) {
            cls += " border-(--primary) text-(--primary) bg-(--primary)/5";
        } else {
            cls += " text-neutral-700 dark:text-neutral-300";
        }

        html += `
			<div class="${cls}" data-month="${index}">
				<span class="text-sm font-bold">${name}</span>
				${hasPost ? `<span class="w-1 h-1 rounded-full bg-(--primary) mt-1"></span>` : `<span class="w-1 h-1 mt-1"></span>`}
			</div>
		`;
    });
    return html;
}

export function buildYearPickerHtml(
    stats: {
        minYear: number;
        maxYear: number;
        hasPostInYear: Record<string, boolean>;
    },
    currentYear: number,
): string {
    let html = "";
    for (let y = stats.minYear; y <= stats.maxYear; y++) {
        const isCurrent = y === currentYear;
        const hasPost = stats.hasPostInYear[y];
        let cls =
            "year-item cursor-pointer rounded-lg flex flex-col items-center justify-center py-3 transition-all hover:bg-(--btn-plain-bg-hover) relative border border-transparent";
        if (isCurrent) {
            cls += " border-(--primary) text-(--primary) bg-(--primary)/5";
        } else {
            cls += " text-neutral-700 dark:text-neutral-300";
        }

        html += `
			<div class="${cls}" data-year="${y}" id="year-${y}">
				<span class="text-sm font-bold">${y}</span>
				${hasPost ? `<span class="w-1.5 h-1.5 rounded-full bg-(--primary) mt-1"></span>` : `<span class="w-1.5 h-1.5 mt-1"></span>`}
			</div>
		`;
    }
    return html;
}

import {
    type CalendarContext,
    fetchCalendarData,
    renderCalendar,
    setupEventListeners,
} from "@/scripts/calendar-widget-helpers";

export function initCalendarWidget(config: CalendarConfig): void {
    const { defaultExpanded } = config;

    const runtimeWindow = window as CalendarRuntimeWindow;
    runtimeWindow.__calendarWidgetCleanup?.();

    const now = new Date();
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth();
    const todayDate = now.getDate();

    const ctx: CalendarContext = {
        config,
        dom: {
            toggleBtn: document.getElementById("calendar-toggle-btn"),
            toggleIcon: document.getElementById("calendar-toggle-icon"),
            body: document.getElementById("calendar-body"),
            loading: document.getElementById("calendar-loading"),
            error: document.getElementById("calendar-load-error"),
            errorText: document.getElementById("calendar-load-error-text"),
            retryBtn: document.getElementById("calendar-retry-btn"),
            content: document.getElementById("calendar-content"),
            yearBtn: document.getElementById("calendar-year-btn"),
            monthBtn: document.getElementById("calendar-month-btn"),
            prevBtn: document.getElementById("prev-month-btn"),
            nextBtn: document.getElementById("next-month-btn"),
            backTodayBtn: document.getElementById("back-to-today-btn"),
            calendarView: document.getElementById("calendar-view"),
            selectionPanel: document.getElementById("selection-panel"),
            selectionContent: document.getElementById("selection-content"),
            grid: document.getElementById("calendar-grid"),
        },
        signal: new AbortController().signal,
        runtimeWindow,
        todayYear,
        todayMonth,
        todayDate,
        allPostsData: [],
        postDateMap: Object.create(null) as Record<string, CalendarPost[]>,
        postsByMonth: Object.create(null) as Record<string, CalendarPost[]>,
        postsByYear: Object.create(null) as Record<string, CalendarPost[]>,
        stats: {
            hasPostInYear: Object.create(null) as Record<string, boolean>,
            hasPostInMonth: Object.create(null) as Record<string, boolean>,
            minYear: todayYear,
            maxYear: todayYear + 5,
        },
        monthGridCache: new Map<string, string>(),
        hasLoadedData: false,
        isLoadingData: false,
        loadError: null,
        dataLoadPromise: null,
        currentYear: todayYear,
        currentMonth: todayMonth,
        selectedDateKey: null,
        activeFilter: null,
        currentView: "day",
        isExpanded: Boolean(defaultExpanded),
    };

    // AbortController needs to be stored separately so cleanup can abort it
    const ac = new AbortController();
    ctx.signal = ac.signal;

    setupEventListeners(ctx);
    renderCalendar(ctx);
    if (ctx.isExpanded) {
        void fetchCalendarData(ctx);
    }

    const cleanup = (): void => {
        ac.abort();
        if (runtimeWindow.__calendarWidgetCleanup === cleanup) {
            runtimeWindow.__calendarWidgetCleanup = undefined;
        }
    };

    runtimeWindow.__calendarWidgetCleanup = cleanup;
}
