import type { Translation } from "../translation";
import { zhCNCore } from "./parts/zh_CN-core";
import { zhCNContent } from "./parts/zh_CN-content";
import { zhCNAuth } from "./parts/zh_CN-auth";
import { zhCNMe } from "./parts/zh_CN-me";
import { zhCNAdmin } from "./parts/zh_CN-admin";
import { zhCNArticleEditor } from "./parts/zh_CN-article-editor";
import { zhCNDiaryEditor } from "./parts/zh_CN-diary-editor";
import { zhCNInteraction } from "./parts/zh_CN-interaction";

export const zh_CN = {
    ...zhCNCore,
    ...zhCNContent,
    ...zhCNAuth,
    ...zhCNMe,
    ...zhCNAdmin,
    ...zhCNArticleEditor,
    ...zhCNDiaryEditor,
    ...zhCNInteraction,
} as Translation;
