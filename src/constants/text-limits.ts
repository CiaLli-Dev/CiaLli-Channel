/**
 * 加权字符长度：CJK 全角字符按 2 计，其它字符按 1 计。
 * 用于在中英文混排场景下得到更符合视觉宽度的长度结果。
 */

const CJK_RE =
    /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u{20000}-\u{2FA1F}]/u;

export function weightedCharLength(str: string): number {
    let len = 0;
    for (const ch of str) {
        len += CJK_RE.test(ch) ? 2 : 1;
    }
    return len;
}

/** 单个字符权重（CJK=2，其它=1）。 */
export function charWeight(ch: string): number {
    return CJK_RE.test(ch) ? 2 : 1;
}

/** 相册标题：最多 20 个加权字符（中文按 2，ASCII 按 1）。 */
export const ALBUM_TITLE_MAX = 20;
/** 文章标题：最多 30 个加权字符（中文按 2，ASCII 按 1）。 */
export const ARTICLE_TITLE_MAX = 30;
/** 单个相册最多照片数。 */
export const ALBUM_PHOTO_MAX = 50;

/** 用户名：最多 14 个加权字符。 */
export const USERNAME_MAX_WEIGHT = 14;

/** 展示名：最多 20 个加权字符。 */
export const DISPLAY_NAME_MAX_WEIGHT = 20;

/** 个人简介：最多 30 个加权字符。 */
export const PROFILE_BIO_MAX_LENGTH = 30;
