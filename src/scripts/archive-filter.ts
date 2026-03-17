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

const POSTS_PER_PAGE = 5;

export function initArchiveFilter(): void {
    // 清除上一次实例的事件监听
    const rw = window as ArchiveRuntimeWindow;
    rw.__archiveFilterCleanup?.();

    // 确认当前页面确实是 archive 页
    const archiveRoot = document.querySelector<HTMLElement>(".archive-posts");
    if (!archiveRoot) {
        return;
    }

    let currentPage = 1;
    let currentFilter: FilterState = {
        tags: [],
        category: null,
        author: null,
        calendar: null,
    };

    const UNCATEGORIZED_LABEL = archiveRoot.dataset.uncategorizedLabel || "";

    function isUncategorizedValue(value: string): boolean {
        return (
            value === "uncategorized" ||
            (UNCATEGORIZED_LABEL !== "" &&
                value.toLowerCase() === UNCATEGORIZED_LABEL.toLowerCase())
        );
    }

    // 每次重新获取 DOM，避免页面切换后引用过期
    function getPostList() {
        return document.getElementById("post-list-container");
    }
    function getNoResults() {
        return document.getElementById("archive-no-results");
    }

    const originalOrder = new Map<HTMLElement, number>();

    function getFilterElements() {
        return {
            filterStatus: document.getElementById("filter-status"),
            filterLabel: document.getElementById("filter-status-label"),
            filterClearBtn: document.getElementById("filter-clear-btn"),
        };
    }

    function getAllPostItems(): HTMLElement[] {
        const postList = getPostList();
        if (!postList) {
            return [];
        }
        const allItems = Array.from(
            postList.querySelectorAll<HTMLElement>(".post-list-item"),
        );
        if (originalOrder.size === 0) {
            allItems.forEach((item, index) => {
                originalOrder.set(item, index);
            });
        }
        return allItems;
    }

    function getSelectedTags(filter: FilterState): string[] {
        return normalizeTagList(filter.tags);
    }

    function readItemAuthorHandleRaw(item: HTMLElement): string {
        const selfHandle = cleanAuthorHandle(item.dataset.authorHandle || "");
        if (selfHandle) {
            return selfHandle;
        }

        const postCard = item.querySelector<HTMLElement>("[data-post-card]");
        return cleanAuthorHandle(postCard?.dataset.authorHandle || "");
    }

    function readItemAuthorHandle(item: HTMLElement): string {
        return normalizeAuthorHandle(readItemAuthorHandleRaw(item));
    }

    function resolveAuthorDisplayByNormalized(normalized: string): string {
        if (!normalized) {
            return "";
        }
        // 展示始终使用卡片上的原始作者名（保留大小写）
        const matched = getAllPostItems().find(
            (item) => readItemAuthorHandle(item) === normalized,
        );
        if (!matched) {
            return "";
        }
        return readItemAuthorHandleRaw(matched);
    }

    function resolveAuthorDisplay(filter: FilterState): string {
        if (!filter.author) {
            return "";
        }

        const normalized = normalizeAuthorHandle(filter.author);
        return resolveAuthorDisplayByNormalized(normalized) || filter.author;
    }

    function hasActiveFilters(filter: FilterState): boolean {
        return (
            getSelectedTags(filter).length > 0 ||
            filter.category !== null ||
            filter.author !== null ||
            filter.calendar !== null
        );
    }

    function parseItemTags(item: HTMLElement): string[] {
        try {
            const parsed = JSON.parse(item.dataset.tags || "[]") as unknown;
            return Array.isArray(parsed)
                ? parsed.map((tag) => String(tag))
                : [];
        } catch (error) {
            console.warn("[archive] failed to parse item tags:", error);
            return [];
        }
    }

    function getTagMatchCount(item: HTMLElement, tags: string[]): number {
        if (tags.length === 0) {
            return 0;
        }
        const itemTags = parseItemTags(item);
        return tags.reduce(
            (count, tag) => (itemTags.includes(tag) ? count + 1 : count),
            0,
        );
    }

    function getMatchingItems(filter: FilterState): HTMLElement[] {
        const allItems = getAllPostItems();
        const selectedTags = getSelectedTags(filter);
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
                const tagScore = hasTagFilter
                    ? getTagMatchCount(item, selectedTags)
                    : 0;
                const tagMatched =
                    !hasTagFilter || tagScore === selectedTags.length;

                const categoryMatched = hasCategoryFilter
                    ? isUncategorizedValue(filter.category!)
                        ? !item.dataset.category
                        : item.dataset.category === filter.category
                    : true;

                const authorMatched = hasAuthorFilter
                    ? readItemAuthorHandle(item) === normalizedAuthor
                    : true;

                let calendarMatched = true;
                if (hasCalendarFilter && filter.calendar) {
                    if (filter.calendar.type === "year") {
                        calendarMatched =
                            item.dataset.year === filter.calendar.key;
                    } else if (filter.calendar.type === "month") {
                        calendarMatched =
                            item.dataset.month === filter.calendar.key;
                    } else {
                        calendarMatched =
                            item.dataset.day === filter.calendar.key;
                    }
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
            .sort((a, b) => {
                if (b.score !== a.score) {
                    return b.score - a.score;
                }
                return (
                    (originalOrder.get(a.item) ?? 0) -
                    (originalOrder.get(b.item) ?? 0)
                );
            })
            .map(({ item }) => item);
    }

    function renderPosts() {
        const postList = getPostList();
        const noResults = getNoResults();
        if (!postList) {
            return;
        }

        const allItems = getAllPostItems();
        const matching = getMatchingItems(currentFilter);
        const totalPages = Math.max(
            1,
            Math.ceil(matching.length / POSTS_PER_PAGE),
        );

        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        const start = (currentPage - 1) * POSTS_PER_PAGE;
        const pageItems = new Set(
            matching.slice(start, start + POSTS_PER_PAGE),
        );
        const matchingSet = new Set(matching);
        const orderedItems =
            getSelectedTags(currentFilter).length > 0
                ? [
                      ...matching,
                      ...allItems.filter((item) => !matchingSet.has(item)),
                  ]
                : allItems;
        const fragment = document.createDocumentFragment();
        orderedItems.forEach((item) => {
            fragment.appendChild(item);
        });
        postList.appendChild(fragment);

        allItems.forEach((item) => {
            item.classList.toggle("hidden", !pageItems.has(item));
        });

        updatePaginationUI(currentPage, totalPages);

        noResults?.classList.toggle(
            "hidden",
            !hasActiveFilters(currentFilter) || matching.length > 0,
        );
    }

    function buildPageNumbers(page: number, totalPages: number): number[] {
        const pages: number[] = [];
        const delta = 2;

        pages.push(1);

        const rangeStart = Math.max(2, page - delta);
        const rangeEnd = Math.min(totalPages - 1, page + delta);

        if (rangeStart > 2) {
            pages.push(-1);
        }

        for (let i = rangeStart; i <= rangeEnd; i++) {
            pages.push(i);
        }

        if (rangeEnd < totalPages - 1) {
            pages.push(-1);
        }

        if (totalPages > 1) {
            pages.push(totalPages);
        }

        return pages;
    }

    function toggleBtnDisabled(id: string, disabled: boolean) {
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

    function updatePaginationUI(page: number, totalPages: number) {
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

    function scrollToPostList() {
        getPostList()?.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    }

    function updateFilterStatus(filter: FilterState) {
        const { filterStatus, filterLabel } = getFilterElements();
        if (!filterStatus || !filterLabel) {
            return;
        }

        if (!hasActiveFilters(filter)) {
            filterStatus.classList.add("is-collapsed");
            return;
        }

        filterStatus.classList.remove("is-collapsed");

        const segments: string[] = [];
        const selectedTags = getSelectedTags(filter);
        if (selectedTags.length > 0) {
            segments.push(`标签：${selectedTags.join("、")}`);
        }
        if (filter.category) {
            segments.push(
                isUncategorizedValue(filter.category)
                    ? `分类：${UNCATEGORIZED_LABEL || "未分类"}`
                    : `分类：${filter.category}`,
            );
        }
        if (filter.author) {
            segments.push(`作者：@${resolveAuthorDisplay(filter)}`);
        }
        if (filter.calendar) {
            segments.push(`日期：${filter.calendar.label}`);
        }

        filterLabel.textContent = segments.join(" ｜ ");
    }

    function updateButtonStates(filter: FilterState) {
        document
            .querySelectorAll<HTMLElement>(".archive-filter-btn")
            .forEach((btn) => btn.classList.remove("active"));

        const selectedTags = getSelectedTags(filter);
        selectedTags.forEach((tag) => {
            const selector = `.archive-filter-btn[data-filter="tag"][data-value="${CSS.escape(tag)}"]`;
            document
                .querySelector<HTMLElement>(selector)
                ?.classList.add("active");
        });

        if (filter.category) {
            const selector = `.archive-filter-btn[data-filter="category"][data-value="${CSS.escape(filter.category)}"]`;
            document
                .querySelector<HTMLElement>(selector)
                ?.classList.add("active");
        }
    }

    function applyFilter(filter: FilterState) {
        currentFilter = filter;
        currentPage = 1;
        renderPosts();
        updateFilterStatus(filter);
        updateButtonStates(filter);
    }

    function clearAllFilters() {
        window.dispatchEvent(new CustomEvent("calendarFilterClear"));

        currentFilter = {
            tags: [],
            category: null,
            author: null,
            calendar: null,
        };
        currentPage = 1;
        renderPosts();
        updateFilterStatus(currentFilter);
        updateButtonStates(currentFilter);
    }

    // --- 使用 AbortController 注册所有事件，便于清理 ---
    const ac = new AbortController();
    const signal = ac.signal;

    // 分类/标签按钮点击（事件委托）
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
            if (filterType === "tag") {
                const selectedTags = getSelectedTags(currentFilter);
                const nextSelected = selectedTags.includes(filterValue)
                    ? selectedTags.filter((tag) => tag !== filterValue)
                    : normalizeTagList([...selectedTags, filterValue]);

                applyFilter({
                    ...currentFilter,
                    tags: nextSelected,
                    calendar: null,
                });
                return;
            }

            applyFilter({
                ...currentFilter,
                category:
                    currentFilter.category === filterValue ? null : filterValue,
                calendar: null,
            });
        },
        { signal },
    );

    // 清除按钮
    getFilterElements().filterClearBtn?.addEventListener(
        "click",
        () => {
            clearAllFilters();
        },
        { signal },
    );

    // 监听日历筛选事件
    window.addEventListener(
        "calendarFilterChange",
        (event) => {
            // 仅在 archive 页面处理
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

            currentFilter = {
                ...currentFilter,
                calendar: {
                    type: detail.type,
                    key: detail.key,
                    label: detail.label || detail.key,
                },
            };

            // 延迟一帧，覆盖 PostPage 的日历筛选结果
            requestAnimationFrame(() => {
                currentPage = 1;
                renderPosts();
                updateFilterStatus(currentFilter);
                updateButtonStates(currentFilter);
            });
        },
        { signal },
    );

    // 监听日历清除事件
    window.addEventListener(
        "calendarFilterClear",
        () => {
            if (currentFilter.calendar !== null) {
                currentFilter = {
                    ...currentFilter,
                    calendar: null,
                };
                currentPage = 1;
                requestAnimationFrame(() => {
                    renderPosts();
                    updateFilterStatus(currentFilter);
                    updateButtonStates(currentFilter);
                });
            }
        },
        { signal },
    );

    // 分页按钮事件
    document.addEventListener(
        "click",
        (e) => {
            const target = e.target as HTMLElement;

            // 上一页
            if (target.id === "page-prev" || target.closest("#page-prev")) {
                if (currentPage > 1) {
                    currentPage--;
                    renderPosts();
                    scrollToPostList();
                }
                return;
            }

            // 下一页
            if (target.id === "page-next" || target.closest("#page-next")) {
                const matching = getMatchingItems(currentFilter);
                const totalPages = Math.max(
                    1,
                    Math.ceil(matching.length / POSTS_PER_PAGE),
                );
                if (currentPage < totalPages) {
                    currentPage++;
                    renderPosts();
                    scrollToPostList();
                }
                return;
            }

            // 页码按钮
            const pageBtn = target.closest<HTMLElement>("[data-page]");
            if (pageBtn) {
                const page = Number(pageBtn.dataset.page);
                if (page && page !== currentPage) {
                    currentPage = page;
                    renderPosts();
                    scrollToPostList();
                }
            }
        },
        { signal },
    );

    // 注册清理函数，下次 init 或离开页面时调用
    rw.__archiveFilterCleanup = () => {
        ac.abort();
        rw.__archiveFilterCleanup = undefined;
    };

    // --- 根据 URL 参数初始化 ---
    const params = new URLSearchParams(window.location.search);
    const tag = params.get("tag");
    const category = params.get("category");
    const author = params.get("author") || params.get("author_handle");
    const uncategorized = params.get("uncategorized");

    const tagParams = params
        .getAll("tag")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean);

    if (tagParams.length > 0) {
        currentFilter.tags = normalizeTagList(tagParams);
    } else if (tag) {
        currentFilter.tags = normalizeTagList([tag]);
    }

    if (category) {
        currentFilter.category = category;
    } else if (uncategorized) {
        currentFilter.category = "uncategorized";
    }

    if (author) {
        const cleanedAuthor = cleanAuthorHandle(author);
        currentFilter.author = cleanedAuthor || null;
    }

    if (hasActiveFilters(currentFilter)) {
        applyFilter(currentFilter);
    } else {
        // 初始渲染：应用分页
        renderPosts();
    }
}
