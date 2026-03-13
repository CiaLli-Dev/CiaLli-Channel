import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { LinkPreset, type NavBarLink } from "@/types/config";

export const LinkPresets: { [key in LinkPreset]: NavBarLink } = {
    [LinkPreset.Home]: {
        name: i18n(I18nKey.coreHome),
        url: "/",
        icon: "material-symbols:home",
    },
    [LinkPreset.About]: {
        name: i18n(I18nKey.coreAbout),
        url: "/about",
        icon: "material-symbols:person",
    },
    [LinkPreset.Archive]: {
        name: i18n(I18nKey.coreArchive),
        url: "/posts",
        icon: "material-symbols:archive",
    },
    [LinkPreset.Friends]: {
        name: i18n(I18nKey.contentFriends),
        url: "/friends",
        icon: "material-symbols:group",
    },
    [LinkPreset.Anime]: {
        name: i18n(I18nKey.contentAnime),
        url: "/me/#bangumi",
        icon: "material-symbols:movie",
    },
    [LinkPreset.Diary]: {
        name: i18n(I18nKey.contentDiary),
        url: "/me/#diary",
        icon: "material-symbols:book",
    },
    [LinkPreset.Albums]: {
        name: i18n(I18nKey.contentAlbums),
        url: "/me/#albums",
        icon: "material-symbols:photo-library",
    },
};
