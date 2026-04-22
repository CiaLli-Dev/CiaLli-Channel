type ArticleSummaryModeDom = {
    articleAiSummaryEnabledInput: HTMLInputElement;
    articleSummaryInput: HTMLTextAreaElement;
};

export function syncArticleSummaryInputForAiMode(
    dom: ArticleSummaryModeDom,
    options: { clearWhenEnabled: boolean },
): void {
    const aiSummaryEnabled = dom.articleAiSummaryEnabledInput.checked;
    if (aiSummaryEnabled && options.clearWhenEnabled) {
        dom.articleSummaryInput.value = "";
    }
    dom.articleSummaryInput.disabled = aiSummaryEnabled;
    dom.articleSummaryInput.setAttribute(
        "aria-disabled",
        aiSummaryEnabled ? "true" : "false",
    );
    dom.articleSummaryInput.classList.toggle(
        "publish-article-summary--ai-locked",
        aiSummaryEnabled,
    );
    dom.articleSummaryInput.classList.toggle(
        "cursor-not-allowed",
        aiSummaryEnabled,
    );
    dom.articleSummaryInput.classList.toggle("opacity-60", aiSummaryEnabled);
}
