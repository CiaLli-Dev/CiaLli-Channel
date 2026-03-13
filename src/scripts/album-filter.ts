/**
 * 相册列表页筛选逻辑。
 *
 * 由 archive-filter.ts 简化而来，仅保留标签/分类/作者筛选；
 * 相册数量较少，不需要日历筛选和分页。
 *
 * 初始化由 `layout/index.ts` 的 `runDynamicPageInit()` 统一触发。
 */

import {
    cleanAuthorHandle,
    normalizeAuthorHandle,
    normalizeTagList,
} from "@/scripts/filter-shared";

type FilterState = {
    tags: string[];
    category: string | null;
    author: string | null;
};

type AlbumFilterRuntimeWindow = Window &
    typeof globalThis & {
        __albumFilterCleanup?: () => void;
    };

function getAlbumItems(): HTMLElement[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>(".album-list-item"),
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
    return (
        getSelectedTags(filter).length > 0 ||
        filter.category !== null ||
        filter.author !== null
    );
}

function readItemAuthorHandleRaw(item: HTMLElement): string {
    return cleanAuthorHandle(item.dataset.authorHandle || "");
}

function readItemAuthorHandle(item: HTMLElement): string {
    return normalizeAuthorHandle(readItemAuthorHandleRaw(item));
}

function resolveAuthorDisplay(filter: FilterState): string {
    if (!filter.author) {
        return "";
    }
    const normalized = normalizeAuthorHandle(filter.author);
    const matched = getAlbumItems().find(
        (item) => readItemAuthorHandle(item) === normalized,
    );
    if (!matched) {
        return filter.author;
    }
    return readItemAuthorHandleRaw(matched) || filter.author;
}

function getMatchingItems(filter: FilterState): Set<HTMLElement> {
    const allItems = getAlbumItems();
    const selectedTags = getSelectedTags(filter);
    const hasTagFilter = selectedTags.length > 0;
    const hasCategoryFilter = filter.category !== null;
    const hasAuthorFilter = filter.author !== null;
    const normalizedAuthor = hasAuthorFilter
        ? normalizeAuthorHandle(filter.author || "")
        : "";

    if (!hasTagFilter && !hasCategoryFilter && !hasAuthorFilter) {
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
        const authorMatched =
            !hasAuthorFilter || readItemAuthorHandle(item) === normalizedAuthor;

        if (tagMatched && categoryMatched && authorMatched) {
            matched.add(item);
        }
    }
    return matched;
}

function readUrlFilterState(): FilterState {
    const params = new URLSearchParams(window.location.search);
    const tagParams = params
        .getAll("tag")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean);
    const category = params.get("category");
    const author = params.get("author") || params.get("author_handle");

    const filter: FilterState = { tags: [], category: null, author: null };

    if (tagParams.length > 0) {
        filter.tags = normalizeTagList(tagParams);
    }
    if (category) {
        filter.category = category;
    }
    if (author) {
        const cleanedAuthor = cleanAuthorHandle(author);
        filter.author = cleanedAuthor || null;
    }
    return filter;
}

export function initAlbumFilter(): void {
    const rw = window as AlbumFilterRuntimeWindow;
    rw.__albumFilterCleanup?.();

    const albumRoot = document.querySelector<HTMLElement>(".album-list-root");
    if (!albumRoot) {
        return;
    }

    let currentFilter: FilterState = {
        tags: [],
        category: null,
        author: null,
    };

    function getNoResults() {
        return document.getElementById("album-no-results");
    }
    function getFilterElements() {
        return {
            filterStatus: document.getElementById("album-filter-status"),
            filterLabel: document.getElementById("album-filter-status-label"),
            filterClearBtn: document.getElementById("album-filter-clear-btn"),
        };
    }

    function render() {
        const allItems = getAlbumItems();
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

        const segments: string[] = [];
        const selectedTags = getSelectedTags(filter);
        if (selectedTags.length > 0) {
            segments.push(`标签：${selectedTags.join("、")}`);
        }
        if (filter.category) {
            segments.push(`分类：${filter.category}`);
        }
        if (filter.author) {
            segments.push(`作者：@${resolveAuthorDisplay(filter)}`);
        }

        filterLabel.textContent = segments.join(" ｜ ");
    }

    function updateButtonStates(filter: FilterState) {
        document
            .querySelectorAll<HTMLElement>(".album-filter-btn")
            .forEach((btn) => btn.classList.remove("active"));

        const selectedTags = getSelectedTags(filter);
        selectedTags.forEach((tag) => {
            const selector = `.album-filter-btn[data-filter="tag"][data-value="${CSS.escape(tag)}"]`;
            document
                .querySelector<HTMLElement>(selector)
                ?.classList.add("active");
        });

        if (filter.category) {
            const selector = `.album-filter-btn[data-filter="category"][data-value="${CSS.escape(filter.category)}"]`;
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
        currentFilter = { tags: [], category: null, author: null };
        render();
        updateFilterStatus(currentFilter);
        updateButtonStates(currentFilter);
    }

    // 统一通过 AbortController 管理事件，便于切页时清理
    const ac = new AbortController();
    const signal = ac.signal;

    document.addEventListener(
        "click",
        (e) => {
            const btn = (e.target as HTMLElement)?.closest<HTMLElement>(
                ".album-filter-btn",
            );
            if (!btn) {
                return;
            }

            const filterType = btn.dataset.filter as "tag" | "category";
            const filterValue = btn.dataset.value || "";
            if (!filterType || !filterValue) {
                return;
            }

            if (filterType === "tag") {
                const selectedTags = getSelectedTags(currentFilter);
                const nextSelected = selectedTags.includes(filterValue)
                    ? selectedTags.filter((tag) => tag !== filterValue)
                    : normalizeTagList([...selectedTags, filterValue]);

                applyFilter({ ...currentFilter, tags: nextSelected });
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

    rw.__albumFilterCleanup = () => {
        ac.abort();
        rw.__albumFilterCleanup = undefined;
    };

    // 读取 URL 查询参数并初始化筛选状态
    currentFilter = readUrlFilterState();

    if (hasActiveFilters(currentFilter)) {
        applyFilter(currentFilter);
    } else {
        render();
    }
}
