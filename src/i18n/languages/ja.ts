import type { Translation } from "../translation";
import { jaCore } from "./parts/ja-core";
import { jaContent } from "./parts/ja-content";
import { jaAuth } from "./parts/ja-auth";
import { jaMe } from "./parts/ja-me";
import { jaAdmin } from "./parts/ja-admin";
import { jaArticleEditor } from "./parts/ja-article-editor";
import { jaDiaryEditor } from "./parts/ja-diary-editor";
import { jaInteraction } from "./parts/ja-interaction";

export const ja = {
    ...jaCore,
    ...jaContent,
    ...jaAuth,
    ...jaMe,
    ...jaAdmin,
    ...jaArticleEditor,
    ...jaDiaryEditor,
    ...jaInteraction,
} as Translation;
