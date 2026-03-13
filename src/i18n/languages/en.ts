import type { Translation } from "../translation";
import { enCore } from "./parts/en-core";
import { enContent } from "./parts/en-content";
import { enAuth } from "./parts/en-auth";
import { enMe } from "./parts/en-me";
import { enAdmin } from "./parts/en-admin";
import { enArticleEditor } from "./parts/en-article-editor";
import { enDiaryEditor } from "./parts/en-diary-editor";
import { enInteraction } from "./parts/en-interaction";

export const en = {
    ...enCore,
    ...enContent,
    ...enAuth,
    ...enMe,
    ...enAdmin,
    ...enArticleEditor,
    ...enDiaryEditor,
    ...enInteraction,
} as Translation;
