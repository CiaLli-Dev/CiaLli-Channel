import type { NavBarLink } from "@/types/config";

export const isAdminOnlyLink = (link: Pick<NavBarLink, "url">): boolean => {
    return /^\/admin(?:\/|$)/.test(link.url);
};
