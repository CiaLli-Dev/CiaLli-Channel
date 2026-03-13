import type { Translation } from "../translation";
import { zhTWCore } from "./parts/zh_TW-core";
import { zhTWContent } from "./parts/zh_TW-content";
import { zhTWAuth } from "./parts/zh_TW-auth";
import { zhTWMe } from "./parts/zh_TW-me";
import { zhTWAdmin } from "./parts/zh_TW-admin";
import { zhTWArticleEditor } from "./parts/zh_TW-article-editor";
import { zhTWDiaryEditor } from "./parts/zh_TW-diary-editor";
import { zhTWInteraction } from "./parts/zh_TW-interaction";

export const zh_TW = {
    ...zhTWCore,
    ...zhTWContent,
    ...zhTWAuth,
    ...zhTWMe,
    ...zhTWAdmin,
    ...zhTWArticleEditor,
    ...zhTWDiaryEditor,
    ...zhTWInteraction,
} as Translation;
