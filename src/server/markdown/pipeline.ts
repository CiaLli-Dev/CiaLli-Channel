import type { RootContent } from "mdast";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeComponents from "rehype-components";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkGithubAdmonitionsToDirectives from "remark-github-admonitions-to-directives";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import type { Pluggable, PluggableList } from "unified";

import { AdmonitionComponent } from "../../plugins/rehype-component-admonition.mjs";
import { GithubCardComponent } from "../../plugins/rehype-component-github-card.mjs";
import { rehypeImageWidth } from "../../plugins/rehype-image-width.mjs";
import { rehypeMermaid } from "../../plugins/rehype-mermaid.mjs";
import { rehypeWrapTable } from "../../plugins/rehype-wrap-table.mjs";
import { parseDirectiveNode } from "../../plugins/remark-directive-rehype.js";
import { remarkContent } from "../../plugins/remark-content.mjs";
import { remarkMermaid } from "../../plugins/remark-mermaid.js";

export type RuntimeMarkdownProfile = "full" | "fast";

export type RuntimeMarkdownFeatures = {
    hasMath: boolean;
    hasDirective: boolean;
    hasMermaid: boolean;
};

type AdmonitionProps = {
    title?: string;
    "has-directive-label"?: boolean;
};

const rehypeComponentsPlugin: Pluggable = [
    rehypeComponents,
    {
        components: {
            github: GithubCardComponent,
            note: (x: AdmonitionProps, y: RootContent[]) =>
                AdmonitionComponent(x, y, "note"),
            tip: (x: AdmonitionProps, y: RootContent[]) =>
                AdmonitionComponent(x, y, "tip"),
            important: (x: AdmonitionProps, y: RootContent[]) =>
                AdmonitionComponent(x, y, "important"),
            caution: (x: AdmonitionProps, y: RootContent[]) =>
                AdmonitionComponent(x, y, "caution"),
            warning: (x: AdmonitionProps, y: RootContent[]) =>
                AdmonitionComponent(x, y, "warning"),
        },
    },
] as unknown as Pluggable;

const rehypeAutolinkPlugin: Pluggable = [
    rehypeAutolinkHeadings,
    {
        behavior: "append",
        properties: {
            className: ["anchor"],
        },
        content: {
            type: "element",
            tagName: "span",
            properties: {
                className: ["anchor-icon"],
            },
            children: [{ type: "text", value: "#" }],
        },
    },
] as unknown as Pluggable;

function createRuntimeRemarkPlugins(
    profile: RuntimeMarkdownProfile,
    features: RuntimeMarkdownFeatures,
): PluggableList {
    const plugins: PluggableList = [];

    if (features.hasMath) {
        plugins.push(remarkMath);
    }
    plugins.push(remarkGfm);

    if (profile === "full") {
        plugins.push(remarkContent);
    }
    if (features.hasDirective) {
        plugins.push(remarkGithubAdmonitionsToDirectives);
        plugins.push(remarkDirective);
    }
    if (profile === "full") {
        plugins.push(remarkSectionize);
    }
    if (features.hasDirective) {
        plugins.push(parseDirectiveNode);
    }
    if (features.hasMermaid) {
        plugins.push(remarkMermaid);
    }

    return plugins;
}

function createRuntimeRehypePlugins(
    profile: RuntimeMarkdownProfile,
    features: RuntimeMarkdownFeatures,
): PluggableList {
    const plugins: PluggableList = [];

    if (features.hasMath) {
        plugins.push(rehypeKatex);
    }
    if (profile === "full") {
        plugins.push(rehypeSlug);
    }
    plugins.push(rehypeWrapTable);
    if (features.hasMermaid) {
        plugins.push(rehypeMermaid);
    }
    plugins.push(rehypeImageWidth);
    if (features.hasDirective) {
        plugins.push(rehypeComponentsPlugin);
    }
    if (profile === "full") {
        plugins.push(rehypeAutolinkPlugin);
    }

    return plugins;
}

export function getRuntimeMarkdownPlugins(
    profile: RuntimeMarkdownProfile,
    features: RuntimeMarkdownFeatures,
): {
    remarkPlugins: PluggableList;
    rehypePlugins: PluggableList;
} {
    return {
        remarkPlugins: createRuntimeRemarkPlugins(profile, features),
        rehypePlugins: createRuntimeRehypePlugins(profile, features),
    };
}

const fullFeatures: RuntimeMarkdownFeatures = {
    hasMath: true,
    hasDirective: true,
    hasMermaid: true,
};

export const remarkPlugins: PluggableList = createRuntimeRemarkPlugins(
    "full",
    fullFeatures,
);

export const rehypePlugins: PluggableList = createRuntimeRehypePlugins(
    "full",
    fullFeatures,
);
