import type { NavBarLink } from "@/types/config";

export const isAdminOnlyLink = (link: Pick<NavBarLink, "url">): boolean => {
    return /^\/admin(?:\/|$)/.test(link.url);
};

export const isPublishLink = (link: Pick<NavBarLink, "url">): boolean => {
    const rawUrl = String(link.url || "").trim();
    if (!rawUrl.startsWith("/")) {
        return false;
    }
    const [pathAndSearch = ""] = rawUrl.split("#", 2);
    const [pathPart = ""] = pathAndSearch.split("?", 2);
    return (pathPart || "/") === "/posts/new";
};
