import type { DARK_MODE, LIGHT_MODE } from "../constants/constants";
import type { JsonValue } from "./json";

export type SiteConfig = {
    title: string;
    subtitle: string;
    siteURL: string; // 站点URL，以斜杠结尾，例如：https://cialli.mysqil.com/
    keywords?: string[]; // 站点关键词，用于生成 <meta name="keywords">
    siteStartDate?: string; // 建站日期，格式：YYYY-MM-DD，用于计算运行天数

    lang:
        | "en"
        | "zh_CN"
        | "zh_TW"
        | "ja"
        | "ko"
        | "es"
        | "th"
        | "vi"
        | "tr"
        | "id";

    themeColor: {
        hue: number;
    };

    // 顶栏标题配置
    navbarTitle?: {
        mode?: "text-icon" | "logo"; // 显示模式："text-icon" 显示图标+文本，"logo" 仅显示Logo
        text: string; // 顶栏标题文本
        icon?: string; // 顶栏标题图标路径
        logo?: string; // 网站Logo图片路径
    };

    // 页面自动缩放配置
    pageScaling?: {
        targetWidth?: number; // 目标宽度，低于此宽度时开始缩放
    };

    // 壁纸模式配置
    wallpaperMode: {
        // 默认壁纸模式：banner=顶部横幅，none=无壁纸
        defaultMode: "banner" | "none";
    };

    banner: {
        src: string | string[]; // Banner 图片源，所有端共用
        position?: "top" | "center" | "bottom";
        carousel?: {
            enable: boolean; // 是否启用轮播
            interval: number; // 轮播间隔时间（秒）
        };
        waves?: {
            enable: boolean; // 是否启用波浪效果
            performanceMode?: boolean; // 性能模式：减少动画复杂度
        };
        imageApi?: {
            enable: boolean; // 是否启用图片API
            url: string; // API地址，返回每行一个图片链接的文本
        };
        homeText?: {
            enable: boolean; // 是否在首页显示自定义文字
            title?: string; // 主标题
            subtitle?: string | string[]; // 副标题，支持单个字符串或字符串数组
            typewriter?: {
                enable: boolean; // 是否启用打字机效果
                speed: number; // 打字速度（毫秒）
                deleteSpeed: number; // 删除速度（毫秒）
                pauseTime: number; // 完整显示后的暂停时间（毫秒）
            };
        };
        navbar?: {
            transparentMode?: "semi" | "full" | "semifull"; // 导航栏透明模式
        };
    };
    toc: {
        enable: boolean;
        mode: "float" | "sidebar"; // 目录显示模式："float" 悬浮按钮模式，"sidebar" 侧边栏模式
        depth: 1 | 2 | 3;
        useJapaneseBadge?: boolean; // 使用日语假名标记（あいうえお...）代替数字
    };
    favicon: Favicon[];
};

export type Favicon = {
    src: string;
    theme?: "light" | "dark";
    sizes?: string;
};

export enum LinkPreset {
    Home = 0,
    Archive = 1,
    About = 2,
    Friends = 3,
    Anime = 4,
    Diary = 5,
    Albums = 6,
}

export type NavBarLink = {
    name: string;
    url: string;
    external?: boolean;
    icon?: string; // 菜单项图标
    children?: (NavBarLink | LinkPreset)[]; // 支持子菜单，可以是NavBarLink或LinkPreset
};

export type NavBarConfig = {
    links: (NavBarLink | LinkPreset)[];
};

export type LIGHT_DARK_MODE = typeof LIGHT_MODE | typeof DARK_MODE;

export type ExpressiveCodeConfig = {
    theme: string;
    hideDuringThemeTransition?: boolean; // 是否在主题切换时隐藏代码块
};

export type AnnouncementConfig = {
    // enable属性已移除，现在通过sidebarLayoutConfig统一控制
    title?: string; // 公告栏标题
    summary: string; // 公告栏摘要（用于侧栏预览）
    body_markdown: string; // 公告页正文内容
    closable?: boolean; // 是否可关闭
};

export type MusicPlayerConfig = {
    enable: boolean; // 是否启用音乐播放器功能
    meting_api: string; // Meting API 地址
    id: string; // 歌单ID
    server: string; // 音乐源服务器
    type: string; // 音乐类型
    marqueeSpeed?: number; // 标题滚动速度(px/s)
};

// 组件配置类型定义
export type WidgetComponentType =
    | "profile"
    | "announcement"
    | "categories"
    | "tags"
    | "toc"
    | "music-player"
    | "site-stats" // 站点统计组件
    | "calendar" // 日历组件
    | "custom";

export type WidgetComponentConfig = {
    type: WidgetComponentType; // 组件类型
    position: "top" | "sticky"; // 组件位置：顶部固定区域或粘性区域
    class?: string; // 自定义CSS类名
    style?: string; // 自定义内联样式
    animationDelay?: number; // 动画延迟时间（毫秒）
    responsive?: {
        collapseThreshold?: number; // 折叠阈值
    };
    customProps?: Record<string, JsonValue>; // 自定义属性，用于扩展组件功能（需可序列化）
};

export type SidebarLayoutConfig = {
    properties: WidgetComponentConfig[]; // 组件配置列表
    components: {
        left: WidgetComponentType[];
        right: WidgetComponentType[];
    };
    defaultAnimation: {
        enable: boolean; // 是否启用默认动画
        baseDelay: number; // 基础延迟时间（毫秒）
        increment: number; // 每个组件递增的延迟时间（毫秒）
    };
};
