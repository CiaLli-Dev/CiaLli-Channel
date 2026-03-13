/**
 * archive-filter 共享类型与纯辅助函数。
 *
 * 从 archive-filter.ts 分离，以使主文件保持在行数限制以内。
 */

export type CalendarFilterState = {
    type: "day" | "month" | "year";
    key: string;
    label: string;
};

export type FilterState = {
    tags: string[];
    category: string | null;
    author: string | null;
    calendar: CalendarFilterState | null;
};

export type ArchiveRuntimeWindow = Window &
    typeof globalThis & {
        __archiveFilterCleanup?: () => void;
    };

export const POSTS_PER_PAGE = 5;

/**
 * 根据当前页和总页数生成分页页码数组。
 * -1 表示省略号（ellipsis）。
 */
export function buildPageNumbers(page: number, totalPages: number): number[] {
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
