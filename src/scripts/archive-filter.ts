/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
/**
 * 归档页筛选与分页逻辑。
 *
 * 从 archive.astro 内联脚本抽离为模块，供全局 layout 运行时在
 * 页面导航后动态导入并再次执行。由于 ES module 在同一文档同一 URL
 * 只会执行一次，不能依赖自动反复触发页面脚本。
 *
 * 初始化由 `layout/index.ts` 的 `runDynamicPageInit()` 统一触发。
 */

import {
    cleanAuthorHandle,
    normalizeAuthorHandle,
    normalizeTagList,
} from "@/scripts/filter-shared";

import {
    buildPageNumbers,
    POSTS_PER_PAGE,
} from "@/scripts/archive-filter-helpers";

// ---- 类型定义 ----

type CalendarFilterState = {
    type: "day" | "month" | "year";
    key: string;
    label: string;
};

type FilterState = {
    tags: string[];
    category: string | null;
    author: string | null;
    calendar: CalendarFilterState | null;
};

type ArchiveRuntimeWindow = Window &
    typeof globalThis & {
        __archiveFilterCleanup?: () => void;
    };

export type { CalendarFilterState, FilterState, ArchiveRuntimeWindow };

// ---- 顶层纯辅助函数 ----

function parseItemTags(item: HTMLElement): string[] {
    try {
        const parsed = JSON.parse(item.dataset.tags || "[]") as unknown;
        return Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
    } catch {
        return [];
    }
}

function toggleBtnDisabled(id: string, disabled: boolean): void {
    const btn = document.getElementById(id);
    if (!btn) {
        return;
    }
    btn.classList.toggle("disabled", disabled);
    if (disabled) {
        btn.setAttribute("aria-disabled", "true");
    } else {
        btn.removeAttribute("aria-disabled");
    }
}

function updatePaginationUI(page: number, totalPages: number): void {
    const container = document.getElementById("archive-pagination");
    if (!container) {
        return;
    }
    container.classList.toggle("hidden", totalPages <= 1);
    if (totalPages <= 1) {
        return;
    }
    const pages = buildPageNumbers(page, totalPages);
    const numbersEl = document.getElementById("page-numbers");
    if (numbersEl) {
        numbersEl.innerHTML = pages
            .map((p) =>
                p === -1
                    ? '<span class="px-1 text-50">...</span>'
                    : p === page
                      ? `<span class="page-num active">${p}</span>`
                      : `<button class="page-num" data-page="${p}">${p}</button>`,
            )
            .join("");
    }
    toggleBtnDisabled("page-prev", page <= 1);
    toggleBtnDisabled("page-next", page >= totalPages);
}

function hasActiveFilters(filter: FilterState): boolean {
    return (
        normalizeTagList(filter.tags).length > 0 ||
        filter.category !== null ||
        filter.author !== null ||
        filter.calendar !== null
    );
}

// ---- ArchiveFilterCore：封装状态与业务逻辑 ----

class ArchiveFilterCore {
    private currentPage = 1;
    private currentFilter: FilterState = {
        tags: [],
        category: null,
        author: null,
        calendar: null,
    };
    private readonly uncategorizedLabel: string;
    private readonly originalOrder = new Map<HTMLElement, number>();

    constructor(uncategorizedLabel: string) {
        this.uncategorizedLabel = uncategorizedLabel;
    }

    getFilter(): FilterState {
        return this.currentFilter;
    }
    getPage(): number {
        return this.currentPage;
    }
    setFilter(f: FilterState): void {
        this.currentFilter = f;
    }
    setPage(p: number): void {
        this.currentPage = p;
    }

    isUncategorizedValue(value: string): boolean {
        return (
            value === "uncategorized" ||
            (this.uncategorizedLabel !== "" &&
                value.toLowerCase() === this.uncategorizedLabel.toLowerCase())
        );
    }

    getAllPostItems(): HTMLElement[] {
        const postList = document.getElementById("post-list-container");
        if (!postList) {
            return [];
        }
        const allItems = Array.from(
            postList.querySelectorAll<HTMLElement>(".post-list-item"),
        );
        if (this.originalOrder.size === 0) {
            allItems.forEach((item, index) =>
                this.originalOrder.set(item, index),
            );
        }
        return allItems;
    }

    readItemAuthorHandleRaw(item: HTMLElement): string {
        const selfHandle = cleanAuthorHandle(item.dataset.authorHandle || "");
        if (selfHandle) {
            return selfHandle;
        }
        const postCard = item.querySelector<HTMLElement>("[data-post-card]");
        return cleanAuthorHandle(postCard?.dataset.authorHandle || "");
    }

    readItemAuthorHandle(item: HTMLElement): string {
        return normalizeAuthorHandle(this.readItemAuthorHandleRaw(item));
    }

    getMatchingItems(filter: FilterState): HTMLElement[] {
        const allItems = this.getAllPostItems();
        const selectedTags = normalizeTagList(filter.tags);
        const hasTagFilter = selectedTags.length > 0;
        const hasCategoryFilter = filter.category !== null;
        const hasAuthorFilter = filter.author !== null;
        const normalizedAuthor = hasAuthorFilter
            ? normalizeAuthorHandle(filter.author || "")
            : "";
        const hasCalendarFilter = filter.calendar !== null;

        if (
            !hasTagFilter &&
            !hasCategoryFilter &&
            !hasAuthorFilter &&
            !hasCalendarFilter
        ) {
            return allItems;
        }

        const withScores = allItems
            .map((item) => {
                const itemTags = parseItemTags(item);
                const tagScore = hasTagFilter
                    ? selectedTags.reduce(
                          (c, tag) => (itemTags.includes(tag) ? c + 1 : c),
                          0,
                      )
                    : 0;
                const tagMatched =
                    !hasTagFilter || tagScore === selectedTags.length;
                const categoryMatched = hasCategoryFilter
                    ? this.isUncategorizedValue(filter.category!)
                        ? !item.dataset.category
                        : item.dataset.category === filter.category
                    : true;
                const authorMatched = hasAuthorFilter
                    ? this.readItemAuthorHandle(item) === normalizedAuthor
                    : true;
                let calendarMatched = true;
                if (hasCalendarFilter && filter.calendar) {
                    const { type, key } = filter.calendar;
                    calendarMatched =
                        type === "year"
                            ? item.dataset.year === key
                            : type === "month"
                              ? item.dataset.month === key
                              : item.dataset.day === key;
                }
                return {
                    item,
                    score: tagScore,
                    matched:
                        tagMatched &&
                        categoryMatched &&
                        authorMatched &&
                        calendarMatched,
                };
            })
            .filter(({ matched }) => matched);

        if (!hasTagFilter) {
            return withScores.map(({ item }) => item);
        }
        return withScores
            .sort((a, b) =>
                b.score !== a.score
                    ? b.score - a.score
                    : (this.originalOrder.get(a.item) ?? 0) -
                      (this.originalOrder.get(b.item) ?? 0),
            )
            .map(({ item }) => item);
    }

    renderPosts(): void {
        const postList = document.getElementById("post-list-container");
        const noResults = document.getElementById("archive-no-results");
        if (!postList) {
            return;
        }
        const allItems = this.getAllPostItems();
        const matching = this.getMatchingItems(this.currentFilter);
        const totalPages = Math.max(
            1,
            Math.ceil(matching.length / POSTS_PER_PAGE),
        );
        if (this.currentPage > totalPages) {
            this.currentPage = totalPages;
        }
        const start = (this.currentPage - 1) * POSTS_PER_PAGE;
        const pageItems = new Set(
            matching.slice(start, start + POSTS_PER_PAGE),
        );
        const matchingSet = new Set(matching);
        const selectedTags = normalizeTagList(this.currentFilter.tags);
        const orderedItems =
            selectedTags.length > 0
                ? [
                      ...matching,
                      ...allItems.filter((item) => !matchingSet.has(item)),
                  ]
                : allItems;
        const fragment = document.createDocumentFragment();
        orderedItems.forEach((item) => fragment.appendChild(item));
        postList.appendChild(fragment);
        allItems.forEach((item) =>
            item.classList.toggle("hidden", !pageItems.has(item)),
        );
        updatePaginationUI(this.currentPage, totalPages);
        noResults?.classList.toggle(
            "hidden",
            !hasActiveFilters(this.currentFilter) || matching.length > 0,
        );
    }

    updateFilterStatus(filter: FilterState): void {
        const filterStatus = document.getElementById("filter-status");
        const filterLabel = document.getElementById("filter-status-label");
        if (!filterStatus || !filterLabel) {
            return;
        }
        if (!hasActiveFilters(filter)) {
            filterStatus.classList.add("is-collapsed");
            return;
        }
        filterStatus.classList.remove("is-collapsed");
        const segments: string[] = [];
        const selectedTags = normalizeTagList(filter.tags);
        if (selectedTags.length > 0) {
            segments.push(`标签：${selectedTags.join("、")}`);
        }
        if (filter.category) {
            segments.push(
                this.isUncategorizedValue(filter.category)
                    ? `分类：${this.uncategorizedLabel || "未分类"}`
                    : `分类：${filter.category}`,
            );
        }
        if (filter.author) {
            const normalized = normalizeAuthorHandle(filter.author);
            const matched = this.getAllPostItems().find(
                (item) => this.readItemAuthorHandle(item) === normalized,
            );
            const display = matched
                ? this.readItemAuthorHandleRaw(matched)
                : filter.author;
            segments.push(`作者：@${display}`);
        }
        if (filter.calendar) {
            segments.push(`日期：${filter.calendar.label}`);
        }
        filterLabel.textContent = segments.join(" ｜ ");
    }

    updateButtonStates(filter: FilterState): void {
        document
            .querySelectorAll<HTMLElement>(".archive-filter-btn")
            .forEach((btn) => btn.classList.remove("active"));
        const selectedTags = normalizeTagList(filter.tags);
        selectedTags.forEach((tag) => {
            document
                .querySelector<HTMLElement>(
                    `.archive-filter-btn[data-filter="tag"][data-value="${CSS.escape(tag)}"]`,
                )
                ?.classList.add("active");
        });
        if (filter.category) {
            document
                .querySelector<HTMLElement>(
                    `.archive-filter-btn[data-filter="category"][data-value="${CSS.escape(filter.category)}"]`,
                )
                ?.classList.add("active");
        }
    }

    applyFilter(filter: FilterState): void {
        this.currentFilter = filter;
        this.currentPage = 1;
        this.renderPosts();
        this.updateFilterStatus(filter);
        this.updateButtonStates(filter);
    }

    clearAllFilters(): void {
        window.dispatchEvent(new CustomEvent("calendarFilterClear"));
        this.currentFilter = {
            tags: [],
            category: null,
            author: null,
            calendar: null,
        };
        this.currentPage = 1;
        this.renderPosts();
        this.updateFilterStatus(this.currentFilter);
        this.updateButtonStates(this.currentFilter);
    }
}

// ---- 事件绑定（顶层）----

function bindFilterButtonClick(
    core: ArchiveFilterCore,
    signal: AbortSignal,
): void {
    document.addEventListener(
        "click",
        (e) => {
            const btn = (e.target as HTMLElement)?.closest<HTMLElement>(
                ".archive-filter-btn",
            );
            if (!btn) {
                return;
            }
            const filterType = btn.dataset.filter as "tag" | "category";
            const filterValue = btn.dataset.value || "";
            if (!filterType || !filterValue) {
                return;
            }
            window.dispatchEvent(new CustomEvent("calendarFilterClear"));
            const cur = core.getFilter();
            if (filterType === "tag") {
                const selectedTags = normalizeTagList(cur.tags);
                const nextTags = selectedTags.includes(filterValue)
                    ? selectedTags.filter((t) => t !== filterValue)
                    : normalizeTagList([...selectedTags, filterValue]);
                core.applyFilter({ ...cur, tags: nextTags, calendar: null });
                return;
            }
            core.applyFilter({
                ...cur,
                category: cur.category === filterValue ? null : filterValue,
                calendar: null,
            });
        },
        { signal },
    );
}

function bindCalendarEvents(
    core: ArchiveFilterCore,
    signal: AbortSignal,
): void {
    window.addEventListener(
        "calendarFilterChange",
        (event) => {
            if (!document.querySelector(".archive-posts")) {
                return;
            }
            const detail = (
                event as CustomEvent<{
                    type: "day" | "month" | "year";
                    key: string;
                    label?: string;
                }>
            ).detail;
            if (!detail) {
                return;
            }
            const next: FilterState = {
                ...core.getFilter(),
                calendar: {
                    type: detail.type,
                    key: detail.key,
                    label: detail.label || detail.key,
                },
            };
            core.setFilter(next);
            requestAnimationFrame(() => {
                core.setPage(1);
                core.renderPosts();
                core.updateFilterStatus(next);
                core.updateButtonStates(next);
            });
        },
        { signal },
    );

    window.addEventListener(
        "calendarFilterClear",
        () => {
            if (core.getFilter().calendar !== null) {
                const next: FilterState = {
                    ...core.getFilter(),
                    calendar: null,
                };
                core.setFilter(next);
                core.setPage(1);
                requestAnimationFrame(() => {
                    core.renderPosts();
                    core.updateFilterStatus(next);
                    core.updateButtonStates(next);
                });
            }
        },
        { signal },
    );
}

function scrollPostListIntoView(): void {
    document.getElementById("post-list-container")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}

function bindPaginationClick(
    core: ArchiveFilterCore,
    signal: AbortSignal,
): void {
    document.addEventListener(
        "click",
        (e) => {
            const target = e.target as HTMLElement;
            if (target.id === "page-prev" || target.closest("#page-prev")) {
                if (core.getPage() > 1) {
                    core.setPage(core.getPage() - 1);
                    core.renderPosts();
                    scrollPostListIntoView();
                }
                return;
            }
            if (target.id === "page-next" || target.closest("#page-next")) {
                const matching = core.getMatchingItems(core.getFilter());
                const totalPages = Math.max(
                    1,
                    Math.ceil(matching.length / POSTS_PER_PAGE),
                );
                if (core.getPage() < totalPages) {
                    core.setPage(core.getPage() + 1);
                    core.renderPosts();
                    scrollPostListIntoView();
                }
                return;
            }
            const pageBtn = target.closest<HTMLElement>("[data-page]");
            if (pageBtn) {
                const page = Number(pageBtn.dataset.page);
                if (page && page !== core.getPage()) {
                    core.setPage(page);
                    core.renderPosts();
                    scrollPostListIntoView();
                }
            }
        },
        { signal },
    );
}

// ---- 主入口 ----

export function initArchiveFilter(): void {
    const rw = window as ArchiveRuntimeWindow;
    rw.__archiveFilterCleanup?.();

    const archiveRoot = document.querySelector<HTMLElement>(".archive-posts");
    if (!archiveRoot) {
        return;
    }

    const core = new ArchiveFilterCore(
        archiveRoot.dataset.uncategorizedLabel || "",
    );
    const ac = new AbortController();
    const { signal } = ac;

    bindFilterButtonClick(core, signal);
    bindCalendarEvents(core, signal);
    bindPaginationClick(core, signal);
    document
        .getElementById("filter-clear-btn")
        ?.addEventListener("click", () => core.clearAllFilters(), { signal });

    rw.__archiveFilterCleanup = () => {
        ac.abort();
        rw.__archiveFilterCleanup = undefined;
    };

    const params = new URLSearchParams(window.location.search);
    const tag = params.get("tag");
    const category = params.get("category");
    const author = params.get("author") || params.get("author_handle");
    const uncategorized = params.get("uncategorized");
    const tagParams = params
        .getAll("tag")
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean);

    const initFilter: FilterState = {
        tags: [],
        category: null,
        author: null,
        calendar: null,
    };
    if (tagParams.length > 0) {
        initFilter.tags = normalizeTagList(tagParams);
    } else if (tag) {
        initFilter.tags = normalizeTagList([tag]);
    }
    if (category) {
        initFilter.category = category;
    } else if (uncategorized) {
        initFilter.category = "uncategorized";
    }
    if (author) {
        const cleaned = cleanAuthorHandle(author);
        initFilter.author = cleaned || null;
    }

    if (hasActiveFilters(initFilter)) {
        core.applyFilter(initFilter);
    } else {
        core.renderPosts();
    }
}
