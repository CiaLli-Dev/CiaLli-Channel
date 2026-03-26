import type { SidebarLayoutConfig, SiteConfig } from "./types/config";
import {
    type SiteSettingsPayload,
    type SystemSiteConfig,
} from "./types/site-settings";
import { LinkPreset } from "./types/config";

export const systemSiteConfig: SystemSiteConfig = {
    siteURL: "https://www.ciallichannel.com/",
    lang: "zh_CN",
    timeZone: "UTC",
    themeColor: {
        hue: 285,
    },
    pageScaling: {
        targetWidth: 2000,
    },
    expressiveCode: {
        theme: "github-dark",
        hideDuringThemeTransition: true,
    },
};

export const defaultSiteSettings: SiteSettingsPayload = {
    site: {
        title: "CiaLli",
        subtitle: "个人博客",
        lang: "zh_CN",
        timeZone: null,
        keywords: [],
        siteStartDate: "2026-02-01",
        favicon: [],
    },
    auth: {
        register_enabled: false,
    },
    navbarTitle: {
        mode: "logo",
        text: "CiaLliUI",
        icon: "assets/home/home.png",
        logo: "assets/home/default-logo.png",
    },
    wallpaperMode: {
        defaultMode: "banner",
    },
    banner: {
        src: [],
        position: "center",
        carousel: {
            enable: true,
            interval: 5,
        },
        waves: {
            enable: true,
            performanceMode: false,
        },
        imageApi: {
            enable: false,
            url: "http://domain.com/api_v2.php?format=text&count=4",
        },
        homeText: {
            enable: true,
            title: "我的小屋",
            subtitle: [
                "没有什么特别的事，但有你就足够了",
                "到现在你依然是我的光",
                "不知不觉，你成了我的每一天",
                "和你聊几句，日子就会变得有点小快乐",
                "今天没什么特别，但也算是个小好日",
            ],
            typewriter: {
                enable: true,
                speed: 100,
                deleteSpeed: 50,
                pauseTime: 2000,
            },
        },
        navbar: {
            transparentMode: "semifull",
        },
    },
    toc: {
        enable: true,
        mode: "sidebar",
        depth: 2,
        useJapaneseBadge: false,
    },
    navBar: {
        links: [
            LinkPreset.Home,
            LinkPreset.Archive,
            {
                name: "发布",
                url: "/posts/new",
                icon: "material-symbols:edit-square",
            },
            {
                name: "我的",
                url: "/content",
                icon: "material-symbols:person",
                children: [
                    {
                        name: "个人主页",
                        url: "/__user__",
                        icon: "material-symbols:account-circle",
                    },
                    {
                        name: "我的 bangumi 收藏",
                        url: "/__user__/bangumi",
                        icon: "material-symbols:movie",
                    },
                    {
                        name: "日记",
                        url: "/__user__/diary",
                        icon: "material-symbols:book",
                    },
                    {
                        name: "相册",
                        url: "/__user__/albums",
                        icon: "material-symbols:photo-library",
                    },
                ],
            },
            {
                name: "关于",
                url: "/content",
                icon: "material-symbols:info",
                children: [
                    {
                        name: "关于我们",
                        url: "/about",
                        icon: "material-symbols:person",
                    },
                    {
                        name: "友情链接",
                        url: "/friends",
                        icon: "material-symbols:group",
                    },
                    {
                        name: "站点统计",
                        url: "/stats",
                        icon: "material-symbols:bar-chart",
                    },
                ],
            },
        ],
    },
    profile: {
        avatar: "assets/images/avatar.webp",
        name: "CiaLli†Channel",
    },
    announcement: {
        title: "",
        summary: "欢迎来到博客！这是一条示例公告",
        body_markdown:
            "欢迎来到博客！\n\n这是公告页示例内容。你可以在管理台公告编辑页使用 **Markdown** 编辑完整公告。",
        closable: true,
    },
    musicPlayer: {
        enable: true,
        meting_api:
            "https://www.bilibili.uno/api?server=:server&type=:type&id=:id&auth=:auth&r=:r",
        id: "14164869977",
        server: "netease",
        type: "playlist",
        marqueeSpeed: 10,
    },
    sakura: {
        enable: false,
    },
    umami: {
        enabled: false,
        baseUrl: "https://api.umami.is",
        scripts:
            '<script defer src="XXXX.XXX" data-website-id="ABCD1234"></script>',
    },
    analytics: {
        gtmId: "GTM-KRX3XGVH",
        clarityId: "tjr3vkhj8i",
    },
};

export function buildLegacySiteConfig(
    system: SystemSiteConfig,
    settings: SiteSettingsPayload,
): SiteConfig {
    return {
        title: settings.site.title,
        subtitle: settings.site.subtitle,
        siteURL: system.siteURL,
        keywords: settings.site.keywords,
        siteStartDate: settings.site.siteStartDate || undefined,
        lang: settings.site.lang || system.lang,
        themeColor: system.themeColor,
        navbarTitle: settings.navbarTitle,
        pageScaling: system.pageScaling,
        wallpaperMode: settings.wallpaperMode,
        banner: settings.banner,
        toc: settings.toc,
        favicon: settings.site.favicon,
    };
}

export const sidebarLayoutConfig: SidebarLayoutConfig = {
    properties: [
        {
            type: "profile",
            position: "top",
            class: "onload-animation",
            animationDelay: 0,
        },
        {
            type: "announcement",
            position: "top",
            class: "onload-animation",
            animationDelay: 50,
        },
        {
            type: "categories",
            position: "sticky",
            class: "onload-animation",
            animationDelay: 150,
            responsive: {
                collapseThreshold: 5,
            },
        },
        {
            type: "tags",
            position: "top",
            class: "onload-animation",
            animationDelay: 250,
            responsive: {
                collapseThreshold: 20,
            },
        },
        {
            type: "site-stats",
            position: "top",
            class: "onload-animation",
            animationDelay: 200,
        },
        {
            type: "calendar",
            position: "top",
            class: "onload-animation",
            animationDelay: 250,
        },
    ],
    components: {
        left: ["profile", "announcement"],
        right: [],
    },
    defaultAnimation: {
        enable: true,
        baseDelay: 0,
        increment: 50,
    },
};
