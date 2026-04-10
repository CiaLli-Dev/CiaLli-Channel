import { setupPageInit } from "@/utils/page-init";

type RepoResponse = {
    description?: string;
    language?: string;
    forks?: number;
    stargazers_count?: number;
    license?: {
        spdx_id?: string;
    };
    owner?: {
        avatar_url?: string;
    };
};

const cache = new Map<string, RepoResponse>();

function formatCompact(value: number): string {
    return Intl.NumberFormat("en-us", {
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(value);
}

async function fetchRepo(repo: string): Promise<RepoResponse> {
    const cached = cache.get(repo);
    if (cached) {
        return cached;
    }
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
        referrerPolicy: "no-referrer",
        headers: {
            Accept: "application/vnd.github+json",
        },
    });
    if (!response.ok) {
        throw new Error(`GITHUB_FETCH_FAILED:${response.status}`);
    }
    const payload = (await response.json()) as RepoResponse;
    cache.set(repo, payload);
    return payload;
}

function fillCard(card: HTMLElement, payload: RepoResponse): void {
    const findField = (field: string): HTMLElement | null => {
        return card.querySelector<HTMLElement>(
            `[data-github-field="${field}"]`,
        );
    };

    const description = findField("description");
    if (description) {
        description.textContent = String(
            payload.description || "Description not set",
        ).replace(/:[a-zA-Z0-9_]+:/g, "");
    }

    const language = findField("language");
    if (language) {
        language.textContent = payload.language || "Unknown";
    }

    const forks = findField("forks");
    if (forks) {
        forks.textContent = formatCompact(
            Number(payload.forks || 0),
        ).replaceAll("\u202f", "");
    }

    const stars = findField("stars");
    if (stars) {
        stars.textContent = formatCompact(
            Number(payload.stargazers_count || 0),
        ).replaceAll("\u202f", "");
    }

    const license = findField("license");
    if (license) {
        license.textContent = payload.license?.spdx_id || "no-license";
    }

    const avatar = findField("avatar");
    if (avatar && payload.owner?.avatar_url) {
        avatar.style.backgroundImage = `url(${payload.owner.avatar_url})`;
        avatar.style.backgroundColor = "transparent";
    }

    card.classList.remove("fetch-waiting");
}

function markError(card: HTMLElement): void {
    card.classList.remove("fetch-waiting");
    card.classList.add("fetch-error");
}

async function initGithubCards(): Promise<void> {
    const cards = Array.from(
        document.querySelectorAll<HTMLElement>(
            "a.card-github[data-github-repo]",
        ),
    );

    await Promise.all(
        cards.map(async (card) => {
            if (card.dataset.githubLoaded === "1") {
                return;
            }
            const repo = String(card.dataset.githubRepo || "").trim();
            if (!repo || !repo.includes("/")) {
                markError(card);
                return;
            }
            try {
                const payload = await fetchRepo(repo);
                fillCard(card, payload);
                card.dataset.githubLoaded = "1";
            } catch (error) {
                console.warn(
                    "[github-card] failed to load repository:",
                    repo,
                    error,
                );
                markError(card);
            }
        }),
    );
}

export async function refreshGithubCards(): Promise<void> {
    await initGithubCards();
}

setupPageInit({
    key: "github-card-runtime",
    init: () => {
        void refreshGithubCards();
    },
    delay: 20,
    runOnPageShow: true,
    stages: ["navigation-settled"],
});
