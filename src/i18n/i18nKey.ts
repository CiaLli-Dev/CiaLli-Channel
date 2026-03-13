import { CoreKey } from "./keys/core";
import { ContentKey } from "./keys/content";
import { AuthKey } from "./keys/auth";
import { MeKey } from "./keys/me";
import { AdminKey } from "./keys/admin";
import { ArticleEditorKey } from "./keys/article-editor";
import { DiaryEditorKey } from "./keys/diary-editor";
import { InteractionKey } from "./keys/interaction";

// 将所有子枚举合并为统一命名空间对象，保持向后兼容访问方式（I18nKey.xxx）
const I18nKey = {
    ...CoreKey,
    ...ContentKey,
    ...AuthKey,
    ...MeKey,
    ...AdminKey,
    ...ArticleEditorKey,
    ...DiaryEditorKey,
    ...InteractionKey,
} as const;

// 导出类型，供 translation.ts 中 [K in I18nKey] 使用
type I18nKey = (typeof I18nKey)[keyof typeof I18nKey];

export default I18nKey;
