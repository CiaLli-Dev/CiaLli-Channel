export const JAPANESE_KATAKANA = [
    "ア",
    "イ",
    "ウ",
    "エ",
    "オ",
    "カ",
    "キ",
    "ク",
    "ケ",
    "コ",
    "サ",
    "シ",
    "ス",
    "セ",
    "ソ",
    "タ",
    "チ",
    "ツ",
    "テ",
    "ト",
    "ナ",
    "ニ",
    "ヌ",
    "ネ",
    "ノ",
    "ハ",
    "ヒ",
    "フ",
    "ヘ",
    "ホ",
    "マ",
    "ミ",
    "ム",
    "メ",
    "モ",
    "ヤ",
    "ユ",
    "ヨ",
    "ラ",
    "リ",
    "ル",
    "レ",
    "ロ",
    "ワ",
    "ヲ",
    "ン",
];

export type TocHeading = {
    id: string;
    text: string;
    level: number;
};

export function buildTocBadgeContent(
    heading: TocHeading,
    heading1Count: number,
    useJapaneseBadge: boolean,
): string {
    if (heading.level === 1) {
        const useKatakana =
            useJapaneseBadge && heading1Count - 1 < JAPANESE_KATAKANA.length;
        const badge = useKatakana
            ? JAPANESE_KATAKANA[heading1Count - 1]
            : String(heading1Count);
        return badge ?? String(heading1Count);
    }
    if (heading.level === 2) {
        return '<div class="transition w-2 h-2 rounded-[0.1875rem] bg-(--toc-badge-bg)"></div>';
    }
    return '<div class="transition w-1.5 h-1.5 rounded-sm bg-black/5 dark:bg-white/10"></div>';
}

export function buildTocEntryHtml(
    heading: TocHeading,
    badgeContent: string,
): string {
    const depthClass =
        heading.level === 1 ? "" : heading.level === 2 ? "ml-4" : "ml-8";
    const isTopLevel = heading.level === 1;
    const badgeExtraClass = isTopLevel
        ? "bg-(--toc-badge-bg) text-(--btn-content)"
        : "";
    const textClass = heading.level <= 2 ? "text-50" : "text-30";
    return `<a href="#${heading.id}" class="px-2 flex gap-2 relative transition w-full min-h-9 rounded-xl hover:bg-(--toc-btn-hover) active:bg-(--toc-btn-active) py-2">
                <div class="transition w-5 h-5 shrink-0 rounded-lg text-xs flex items-center justify-center font-bold ${depthClass} ${badgeExtraClass}">
                    ${badgeContent}
                </div>
                <div class="transition text-sm ${textClass}">${heading.text}</div>
            </a>`;
}

export function buildTocHtml(
    headings: TocHeading[],
    useJapaneseBadge: boolean,
): string {
    let heading1Count = 0;
    return headings
        .map((heading) => {
            if (heading.level === 1) {
                heading1Count += 1;
            }
            const badgeContent = buildTocBadgeContent(
                heading,
                heading1Count,
                useJapaneseBadge,
            );
            return buildTocEntryHtml(heading, badgeContent);
        })
        .join("");
}
