import { builtinModules } from "node:module";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const projectRootDir = fileURLToPath(new URL("../..", import.meta.url));
const workerEntry = resolvePath(
    projectRootDir,
    "src/worker/ai-summary/server.ts",
);

const externalBuiltins = [
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
];

export default {
    publicDir: false,
    resolve: {
        alias: {
            "@": resolvePath(projectRootDir, "src"),
            "@components": resolvePath(projectRootDir, "src/components"),
            "@assets": resolvePath(projectRootDir, "src/assets"),
            "@constants": resolvePath(projectRootDir, "src/constants"),
            "@utils": resolvePath(projectRootDir, "src/utils"),
            "@i18n": resolvePath(projectRootDir, "src/i18n"),
            "@layouts": resolvePath(projectRootDir, "src/layouts"),
        },
    },
    ssr: {
        noExternal: true,
    },
    build: {
        target: "node24",
        outDir: resolvePath(projectRootDir, "dist/worker"),
        emptyOutDir: false,
        minify: false,
        sourcemap: false,
        ssr: workerEntry,
        rollupOptions: {
            external: externalBuiltins,
            output: {
                entryFileNames: "entry.mjs",
                format: "es",
            },
        },
    },
};
