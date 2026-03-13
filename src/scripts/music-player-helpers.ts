/**
 * MusicPlayer.svelte 辅助函数。
 *
 * 从 MusicPlayer.svelte script 块中分离，使其保持在行数限制以内。
 * 只包含不依赖 Svelte 响应式变量的纯函数和辅助函数。
 */

import type { JsonObject, JsonValue } from "../types/json";
import {
    getJsonNumber,
    getJsonString,
    isJsonObject,
} from "../utils/json-utils";
import { i18n } from "../i18n/translation";
import Key from "../i18n/i18nKey";

export type Song = {
    id: number | string;
    title: string;
    artist: string;
    cover: string;
    url: string;
    duration: number;
};

export type PlaybackState = {
    index?: number;
    songId?: number | string;
    time?: number;
};

export type PlayerDisplayMode = "mini" | "expanded" | "orb";

export const STORAGE_KEY_VOLUME = "music-player-volume";
export const PLAYBACK_STATE_STORAGE_KEY = "music-player:playback-state";

/**
 * 解析 Meting API 返回的单首歌曲数据。
 */
export function parseMetingSong(value: JsonValue): Song {
    const object: JsonObject = isJsonObject(value) ? value : {};

    const title =
        getJsonString(object, "name") ??
        getJsonString(object, "title") ??
        i18n(Key.coreUnknownSong);
    const artist =
        getJsonString(object, "artist") ??
        getJsonString(object, "author") ??
        i18n(Key.coreUnknownArtist);

    const rawId = object.id;
    const id =
        typeof rawId === "number" || typeof rawId === "string" ? rawId : "";

    let dur = getJsonNumber(object, "duration") ?? 0;
    if (dur > 10000) dur = Math.floor(dur / 1000);
    if (!Number.isFinite(dur) || dur <= 0) dur = 0;

    return {
        id,
        title,
        artist,
        cover: getJsonString(object, "pic") ?? "",
        url: getJsonString(object, "url") ?? "",
        duration: dur,
    };
}

/**
 * 格式化秒数为 m:ss 格式。
 */
export function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 处理资源路径，确保以 / 或 http(s):// 开头。
 */
export function getAssetPath(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (path.startsWith("/")) return path;
    return `/${path}`;
}

/**
 * 从 localStorage 读取保存的音量（0~1）。
 * 返回 null 表示没有有效的已保存值。
 */
export function readVolumeSettings(): number | null {
    try {
        if (typeof localStorage === "undefined") return null;
        const savedVolume = localStorage.getItem(STORAGE_KEY_VOLUME);
        if (savedVolume !== null && !Number.isNaN(Number(savedVolume))) {
            return Number(savedVolume);
        }
    } catch (error) {
        console.warn("音乐播放器音量设置读取失败:", error);
    }
    return null;
}

/**
 * 保存音量到 localStorage。
 */
export function saveVolumeSettings(volume: number): void {
    try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(STORAGE_KEY_VOLUME, volume.toString());
    } catch (error) {
        console.warn("音乐播放器音量设置保存失败:", error);
    }
}

/**
 * 从 localStorage 读取保存的播放状态。
 */
export function readPlaybackState(): PlaybackState | null {
    try {
        if (typeof localStorage === "undefined") return null;
        const stored = localStorage.getItem(PLAYBACK_STATE_STORAGE_KEY);
        if (!stored) return null;
        const parsed = JSON.parse(stored) as PlaybackState;
        if (parsed && typeof parsed === "object") {
            return parsed;
        }
    } catch (error) {
        console.warn("音乐播放器播放状态读取失败:", error);
    }
    return null;
}

/**
 * 保存播放状态到 localStorage。
 */
export function savePlaybackState(state: PlaybackState): void {
    try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(PLAYBACK_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.warn("音乐播放器播放状态持久化失败:", error);
    }
}

/**
 * 读取播放器显示模式（当前实现始终返回 null，不做持久化）。
 */
export function readDisplayMode(): PlayerDisplayMode | null {
    return null;
}

/**
 * 构建 Meting API 请求 URL。
 */
export function buildMetingApiUrl(
    metingApi: string,
    server: string,
    type: string,
    id: string,
): string {
    return metingApi
        .replace(":server", server)
        .replace(":type", type)
        .replace(":id", id)
        .replace(":auth", "")
        .replace(":r", Date.now().toString());
}

/**
 * 从 Meting API 获取歌单数据，返回 Song 数组。
 * 失败时返回 null。
 */
export async function fetchPlaylistFromMeting(
    metingApi: string,
    server: string,
    type: string,
    id: string,
): Promise<Song[] | null> {
    if (!metingApi || !id) return null;
    try {
        const apiUrl = buildMetingApiUrl(metingApi, server, type, id);
        const res = await fetch(apiUrl);
        if (!res.ok) return null;
        const list = (await res.json()) as JsonValue;
        return Array.isArray(list) ? list.map(parseMetingSong) : [];
    } catch {
        return null;
    }
}

/**
 * 根据存储的播放状态在播放列表中确定目标索引。
 * 返回 -1 表示无匹配项。
 */
export function resolveStoredPlaybackIndex(
    state: PlaybackState,
    playlist: Song[],
): number {
    if (playlist.length === 0) return -1;
    let targetIndex = -1;
    if (state.songId !== undefined) {
        targetIndex = playlist.findIndex(
            (song) => String(song.id) === String(state.songId),
        );
    }
    if (targetIndex < 0 && typeof state.index === "number") {
        targetIndex = Math.min(Math.max(state.index, 0), playlist.length - 1);
    }
    return targetIndex;
}

/**
 * 计算下一首歌曲的索引（支持随机和顺序模式）。
 */
export function getNextSongIndex(
    currentIndex: number,
    playlistLength: number,
    isShuffled: boolean,
): number {
    if (playlistLength <= 1) return currentIndex;
    if (isShuffled) {
        let newIndex: number;
        do {
            newIndex = Math.floor(Math.random() * playlistLength);
        } while (newIndex === currentIndex && playlistLength > 1);
        return newIndex;
    }
    return currentIndex < playlistLength - 1 ? currentIndex + 1 : 0;
}

/**
 * 计划在延迟后清除跑马灯暂停状态，返回 timer ID。
 */
export function scheduleMarqueeResume(
    pauseMs: number,
    onResume: () => void,
): number {
    return window.setTimeout(onResume, pauseMs);
}

/**
 * 更新标题跑马灯动画的 CSS 变量。
 */
export function updateTitleMarquee(
    element: HTMLDivElement | null,
    setActive: (value: boolean) => void,
    marqueeSpeed: number,
    marqueeGap: number,
): void {
    if (!element) return;
    const textElement = element.querySelector(
        ".title-marquee__text--main",
    ) as HTMLElement | null;
    const textWidth = textElement?.scrollWidth ?? 0;
    const clientWidth = element.clientWidth;
    const shouldMarquee = textWidth > clientWidth + 1;
    setActive(shouldMarquee);
    if (shouldMarquee) {
        const distance = Math.max(0, textWidth + marqueeGap);
        const dur = Math.min(Math.max(distance / marqueeSpeed, 8), 20);
        element.style.setProperty("--marquee-distance", `${distance}px`);
        element.style.setProperty("--marquee-duration", `${dur}s`);
        element.style.setProperty("--marquee-gap", `${marqueeGap}px`);
    } else {
        element.style.removeProperty("--marquee-distance");
        element.style.removeProperty("--marquee-duration");
        element.style.removeProperty("--marquee-gap");
    }
}

/**
 * 计算进度条或音量条点击后对应的百分比（0~1）。
 */
export function calcBarPercent(clientX: number, rect: DOMRect): number {
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

/**
 * 计算恢复播放时的实际时间（防止超过总时长）。
 */
export function clampRestoreTime(
    pendingTime: number,
    audioDuration: number | undefined,
): number {
    if (audioDuration && audioDuration > 0) {
        return Math.min(pendingTime, audioDuration);
    }
    return pendingTime;
}
