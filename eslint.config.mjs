import { builtinModules } from "node:module";

import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import hooks from "eslint-plugin-react-hooks";
import imports from "eslint-plugin-simple-import-sort";
import globals from "globals";
import ts from "typescript-eslint";

const privilegedModules = [...builtinModules, "node:*", "electron", "steamworks.js"];

export default ts.config(
  {
    ignores: [
      "node_modules/**",
      "out/**",
      "dist/**",
      "dist-electron/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".e2e-build/**",
      ".husky/_/**",
    ],
  },
  js.configs.recommended,
  {
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    languageOptions: { globals: globals.node },
    plugins: { "simple-import-sort": imports },
    rules: {
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "no-eval": "error",
      "no-new-func": "error",
      "no-warning-comments": "error",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [ts.configs.strictTypeChecked, ts.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { boolean: true } },
      ],
    },
  },
  {
    files: ["src/renderer/**/*.ts", "src/renderer/**/*.tsx"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...privilegedModules, "**/main/**", "**/preload/**", "@main/*", "@preload/*"],
              message: "Renderer code must use the preload API, not privileged modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                ...privilegedModules,
                "react",
                "react/*",
                "react-dom",
                "react-dom/*",
                "**/main/**",
                "**/renderer/**",
                "**/preload/**",
                "@main/*",
                "@renderer/*",
                "@preload/*",
              ],
              message: "Shared domain code must remain platform-independent.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react/*",
                "react-dom",
                "react-dom/*",
                "**/renderer/**",
                "@renderer/*",
              ],
              message: "Privileged code cannot depend on renderer implementation.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/shared/ipc.ts", "src/shared/domainConstants.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/^(steam:|mod-store:|settings:|diagnostics:|rimworld:|mod:|app:(before-close|close-ready))/]",
          message:
            "Use ipcChannels or ipcEvents from shared/ipc instead of duplicating a wire key.",
        },
        {
          selector:
            "Literal[value=/^(subscribe-mods|unsubscribe-mods|unsubscribe-inactive|subscribe-selected|unsubscribe-outside|apply-active|workshop-folders|steam-client)$/]",
          message:
            "Use the shared domain constant instead of duplicating a persisted action or status.",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    // Async test doubles model the Promise-based API even when their bodies are synchronous.
    rules: { "@typescript-eslint/require-await": "off" },
  },
  prettier,
  { rules: { curly: ["error", "all"] } },
);
