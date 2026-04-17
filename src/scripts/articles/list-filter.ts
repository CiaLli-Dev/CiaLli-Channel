/**
 * 文章列表页只负责维护 URL 查询，不再在前端持有整份文章集合做本地筛选。
 *
 * 这样 SSR 可以直接按查询参数返回当前页结果，避免首屏先拉全量文章再二次裁剪。
 */

import { navigateToPage } from "@/utils/navigation-utils";
import { normalizeTagList } from "@/scripts/shared/filter-shared";

import type { ArticleListRuntimeWindow } from "@/scripts/articles/list-filter-helpers";

function buildNextUrl(mutator: (params: URLSearchParams) => void): string {
    const nextUrl = new URL(window.location.href);
    mutator(nextUrl.searchParams);
    const normalizedSearch = nextUrl.searchParams.toString();
    return `${nextUrl.pathname}${normalizedSearch ? `?${normalizedSearch}` : ""}`;
}

function navigateWithUpdatedParams(
    mutator: (params: URLSearchParams) => void,
): void {
    navigateToPage(
        buildNextUrl((params) => {
            mutator(params);
        }),
    );
}

function bindFilterButtonClick(signal: AbortSignal): void {
    document.addEventListener(
        "click",
        (event) => {
            const button = (event.target as HTMLElement)?.closest<HTMLElement>(
                ".article-list-filter-btn",
            );
            if (!button) {
                return;
            }

            const filterType = button.dataset.filter;
            const filterValue = String(button.dataset.value || "").trim();
            if (!filterType || !filterValue) {
                return;
            }

            navigateWithUpdatedParams((params) => {
                params.delete("page");
                if (filterType === "tag") {
                    const currentTags = normalizeTagList(
                        params
                            .getAll("tag")
                            .flatMap((value) => value.split(",")),
                    );
                    const nextTags = currentTags.includes(filterValue)
                        ? currentTags.filter((tag) => tag !== filterValue)
                        : normalizeTagList([...currentTags, filterValue]);
                    params.delete("tag");
                    for (const tag of nextTags) {
                        params.append("tag", tag);
                    }
                    return;
                }

                const currentCategory = params.get("category");
                const isUncategorized =
                    params.has("uncategorized") &&
                    filterValue === "uncategorized";
                const nextCategory =
                    currentCategory === filterValue || isUncategorized
                        ? null
                        : filterValue;

                params.delete("category");
                params.delete("uncategorized");
                if (nextCategory === null) {
                    return;
                }
                if (nextCategory === "uncategorized") {
                    params.set("uncategorized", "1");
                    return;
                }
                params.set("category", nextCategory);
            });
        },
        { signal },
    );
}

function bindPaginationClick(signal: AbortSignal): void {
    const readPaginationState = (): {
        currentPage: number;
        totalPages: number;
    } => {
        const root = document.querySelector<HTMLElement>(".article-list-page");
        return {
            currentPage: Number(root?.dataset.currentPage || "1") || 1,
            totalPages: Number(root?.dataset.totalPages || "1") || 1,
        };
    };

    const resolveRelativePageFromTarget = (
        target: HTMLElement,
        currentPage: number,
        totalPages: number,
    ): number | null => {
        if (target.id === "page-prev" || target.closest("#page-prev")) {
            return currentPage > 1 ? currentPage - 1 : null;
        }
        if (target.id === "page-next" || target.closest("#page-next")) {
            return currentPage < totalPages ? currentPage + 1 : null;
        }
        return null;
    };

    const resolveExplicitPageFromTarget = (
        target: HTMLElement,
    ): number | null => {
        const pageButton = target.closest<HTMLElement>("[data-page]");
        if (!pageButton) {
            return null;
        }
        const nextPage = Number(pageButton.dataset.page || "");
        if (!Number.isFinite(nextPage) || nextPage <= 0) {
            return null;
        }
        return nextPage;
    };

    const resolvePageFromTarget = (target: HTMLElement): number | null => {
        const { currentPage, totalPages } = readPaginationState();
        return (
            resolveRelativePageFromTarget(target, currentPage, totalPages) ??
            resolveExplicitPageFromTarget(target)
        );
    };

    document.addEventListener(
        "click",
        (event) => {
            const target = event.target as HTMLElement;
            const nextPage = resolvePageFromTarget(target);
            if (nextPage === null) {
                return;
            }
            navigateWithUpdatedParams((params) => {
                params.set("page", String(nextPage));
            });
        },
        { signal },
    );
}

function bindClearFilter(signal: AbortSignal): void {
    document.getElementById("filter-clear-btn")?.addEventListener(
        "click",
        () => {
            navigateWithUpdatedParams((params) => {
                params.delete("page");
                params.delete("tag");
                params.delete("category");
                params.delete("uncategorized");
                params.delete("author");
                params.delete("author_handle");
                params.delete("q");
            });
        },
        { signal },
    );
}

export function initArticleListFilter(): void {
    const runtimeWindow = window as ArticleListRuntimeWindow;
    runtimeWindow.__articleListFilterCleanup?.();

    const articleListRoot =
        document.querySelector<HTMLElement>(".article-list-page");
    if (!articleListRoot) {
        return;
    }

    const abortController = new AbortController();
    const { signal } = abortController;

    bindFilterButtonClick(signal);
    bindPaginationClick(signal);
    bindClearFilter(signal);

    runtimeWindow.__articleListFilterCleanup = () => {
        abortController.abort();
        runtimeWindow.__articleListFilterCleanup = undefined;
    };
}
