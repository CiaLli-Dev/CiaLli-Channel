/**
 * Bangumi 收藏页筛选逻辑。
 *
 * 复用相册筛选思路，仅保留标签/分类筛选，不包含作者和日历。
 * 初始化由 `layout/index.ts` 的 `runDynamicPageInit()` 统一触发。
 */

import { normalizeTagList } from "@/scripts/filter-shared";

type FilterState = {
    tags: string[];
    category: string | null;
};

type BangumiFilterRuntimeWindow = Window &
    typeof globalThis & {
        __bangumiFilterCleanup?: () => void;
    };

function getBangumiItems(): HTMLElement[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>(".bangumi-list-item"),
    );
}

function parseItemTags(item: HTMLElement): string[] {
    try {
        const parsed = JSON.parse(item.dataset.tags || "[]") as unknown;
        return Array.isArray(parsed) ? parsed.map((tag) => String(tag)) : [];
    } catch {
        return [];
    }
}

function getSelectedTags(filter: FilterState): string[] {
    return normalizeTagList(filter.tags);
}

function hasActiveFilters(filter: FilterState): boolean {
    return getSelectedTags(filter).length > 0 || filter.category !== null;
}

function getMatchingItems(filter: FilterState): Set<HTMLElement> {
    const allItems = getBangumiItems();
    const selectedTags = getSelectedTags(filter);
    const hasTagFilter = selectedTags.length > 0;
    const hasCategoryFilter = filter.category !== null;

    if (!hasTagFilter && !hasCategoryFilter) {
        return new Set(allItems);
    }

    const matched = new Set<HTMLElement>();
    for (const item of allItems) {
        const tagMatched =
            !hasTagFilter ||
            (() => {
                const itemTags = parseItemTags(item);
                return selectedTags.every((tag) => itemTags.includes(tag));
            })();
        const categoryMatched =
            !hasCategoryFilter || item.dataset.category === filter.category;

        if (tagMatched && categoryMatched) {
            matched.add(item);
        }
    }
    return matched;
}

function resolveCategoryDisplay(category: string): string {
    const selector = `.bangumi-filter-btn[data-filter="category"][data-value="${CSS.escape(category)}"]`;
    const button = document.querySelector<HTMLElement>(selector);
    if (!button) {
        return category;
    }

    const label =
        button.querySelector<HTMLElement>("span span")?.textContent ||
        button.textContent;
    return String(label || category).trim();
}

function readUrlFilterState(): FilterState {
    const params = new URLSearchParams(window.location.search);
    const tagParams = params
        .getAll("tag")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean);
    const category = params.get("category");

    const filter: FilterState = { tags: [], category: null };

    if (tagParams.length > 0) {
        filter.tags = normalizeTagList(tagParams);
    }
    if (category) {
        filter.category = category;
    }
    return filter;
}

export function initBangumiFilter(): void {
    const rw = window as BangumiFilterRuntimeWindow;
    rw.__bangumiFilterCleanup?.();

    const bangumiRoot =
        document.querySelector<HTMLElement>(".bangumi-list-root");
    if (!bangumiRoot) {
        return;
    }
    const root = bangumiRoot;

    let currentFilter: FilterState = {
        tags: [],
        category: null,
    };

    function getNoResults() {
        return document.getElementById("bangumi-no-results");
    }

    function getFilterElements() {
        return {
            filterStatus: document.getElementById("bangumi-filter-status"),
            filterLabel: document.getElementById("bangumi-filter-status-label"),
            filterClearBtn: document.getElementById("bangumi-filter-clear-btn"),
        };
    }

    function render() {
        const allItems = getBangumiItems();
        const noResults = getNoResults();
        const matching = getMatchingItems(currentFilter);

        allItems.forEach((item) => {
            item.classList.toggle("hidden", !matching.has(item));
        });

        noResults?.classList.toggle(
            "hidden",
            !hasActiveFilters(currentFilter) || matching.size > 0,
        );
    }

    function updateFilterStatus(filter: FilterState) {
        const { filterStatus, filterLabel } = getFilterElements();
        if (!filterStatus || !filterLabel) {
            return;
        }

        if (!hasActiveFilters(filter)) {
            filterStatus.classList.add("hidden");
            filterStatus.classList.remove("flex");
            return;
        }

        filterStatus.classList.remove("hidden");
        filterStatus.classList.add("flex");

        const tagsLabel = root.dataset.tagsLabel || "标签";
        const categoryLabel = root.dataset.categoryLabel || "分类";

        const segments: string[] = [];
        const selectedTags = getSelectedTags(filter);
        if (selectedTags.length > 0) {
            segments.push(`${tagsLabel}：${selectedTags.join("、")}`);
        }
        if (filter.category) {
            segments.push(
                `${categoryLabel}：${resolveCategoryDisplay(filter.category)}`,
            );
        }

        filterLabel.textContent = segments.join(" ｜ ");
    }

    function updateButtonStates(filter: FilterState) {
        document
            .querySelectorAll<HTMLElement>(".bangumi-filter-btn")
            .forEach((btn) => btn.classList.remove("active"));

        const selectedTags = getSelectedTags(filter);
        selectedTags.forEach((tag) => {
            const selector = `.bangumi-filter-btn[data-filter="tag"][data-value="${CSS.escape(tag)}"]`;
            document
                .querySelector<HTMLElement>(selector)
                ?.classList.add("active");
        });

        if (filter.category) {
            const selector = `.bangumi-filter-btn[data-filter="category"][data-value="${CSS.escape(filter.category)}"]`;
            document
                .querySelector<HTMLElement>(selector)
                ?.classList.add("active");
        }
    }

    function applyFilter(filter: FilterState) {
        currentFilter = filter;
        render();
        updateFilterStatus(filter);
        updateButtonStates(filter);
    }

    function clearAllFilters() {
        currentFilter = { tags: [], category: null };
        render();
        updateFilterStatus(currentFilter);
        updateButtonStates(currentFilter);
    }

    // 使用 AbortController 统一管理事件，便于切页后清理。
    const ac = new AbortController();
    const signal = ac.signal;

    document.addEventListener(
        "click",
        (event) => {
            const button = (event.target as HTMLElement)?.closest<HTMLElement>(
                ".bangumi-filter-btn",
            );
            if (!button) {
                return;
            }

            const filterType = button.dataset.filter as "tag" | "category";
            const filterValue = button.dataset.value || "";
            if (!filterType || !filterValue) {
                return;
            }

            if (filterType === "tag") {
                const selectedTags = getSelectedTags(currentFilter);
                const nextSelected = selectedTags.includes(filterValue)
                    ? selectedTags.filter((tag) => tag !== filterValue)
                    : normalizeTagList([...selectedTags, filterValue]);

                applyFilter({
                    ...currentFilter,
                    tags: nextSelected,
                });
                return;
            }

            applyFilter({
                ...currentFilter,
                category:
                    currentFilter.category === filterValue ? null : filterValue,
            });
        },
        { signal },
    );

    getFilterElements().filterClearBtn?.addEventListener(
        "click",
        () => clearAllFilters(),
        { signal },
    );

    rw.__bangumiFilterCleanup = () => {
        ac.abort();
        rw.__bangumiFilterCleanup = undefined;
    };

    // 从 URL 读取初始筛选参数。
    currentFilter = readUrlFilterState();

    if (hasActiveFilters(currentFilter)) {
        applyFilter(currentFilter);
    } else {
        render();
    }
}
