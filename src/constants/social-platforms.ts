export type SocialPlatformMeta = {
    label: string;
    icon: string;
};

export const SOCIAL_PLATFORM_META: Record<string, SocialPlatformMeta> = {
    github: { label: "GitHub", icon: "fa7-brands:github" },
    twitter: { label: "Twitter", icon: "fa7-brands:x-twitter" },
    bilibili: { label: "Bilibili", icon: "fa7-brands:bilibili" },
    discord: { label: "Discord", icon: "fa7-brands:discord" },
    youtube: { label: "YouTube", icon: "fa7-brands:youtube" },
    mastodon: { label: "Mastodon", icon: "fa7-brands:mastodon" },
    telegram: { label: "Telegram", icon: "fa7-brands:telegram" },
    steam: { label: "Steam", icon: "fa7-brands:steam" },
    email: { label: "Email", icon: "material-symbols:mail" },
    website: { label: "Website", icon: "material-symbols:language" },
    gitee: { label: "Gitee", icon: "mdi:git" },
    codeberg: { label: "Codeberg", icon: "simple-icons:codeberg" },
};

export const SOCIAL_PLATFORMS = Object.keys(SOCIAL_PLATFORM_META);
