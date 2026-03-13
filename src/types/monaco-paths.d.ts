declare module "monaco-editor/esm/vs/editor/editor.api" {
    export * from "monaco-editor";
}

declare module "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution" {
    export {};
}

declare module "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices" {
    export const StandaloneServices: {
        get: (serviceId: unknown) => unknown;
    };
}

declare module "monaco-editor/esm/vs/editor/standalone/common/standaloneTheme" {
    export const IStandaloneThemeService: unknown;
}
