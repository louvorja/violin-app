import pluginVue from "eslint-plugin-vue";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  js.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    // Vue SFCs: vue-eslint-parser como parser principal,
    // @typescript-eslint/parser delegado para blocos <script lang="ts">
    files: ["**/*.vue"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        // Tipos ambientes (src/vite-env.d.ts e lib.dom) usados nos blocos <script lang="ts">
        LouvorjaApi: "readonly",
        FullscreenOptions: "readonly",
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // Sem isto, um identificador com letra a mais (fetchWithTimeoutm) passava
      // no lint e só falhava em uso, nos SFCs com <script> em JS puro.
      "no-undef": "error",
    },
  },
  {
    // Arquivos .ts puros: usar diretamente o parser TS
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-redeclare": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/require-default-prop": "warn",
      "vue/no-unused-vars": "error",
      "vue/html-self-closing": [
        "warn",
        { html: { void: "always", normal: "always", component: "always" } },
      ],
      "vue/valid-v-on": ["error", { modifiers: ["window"] }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      radix: "error",
      // Imports entre src/ e electron/ devem usar alias (@/helpers/X) ou IPC
      "no-restricted-imports": ["error", { patterns: ["../..electron/*", "../..src/*"] }],
    },
  },
  {
    // Componentes da shell: multi-word obrigatório, com ignores para nomes single-word
    // consagrados que não colidem com HTML nativo.
    files: ["src/components/**/*.vue", "src/layout/**/*.vue"],
    rules: {
      "vue/multi-word-component-names": [
        "warn",
        {
          ignores: [
            "Alert",
            "Footer",
            "Loading",
            "Modules",
            "Player",
            "Screen",
            "Slide",
            "Toolbar",
            "Window",
          ],
        },
      ],
    },
  },
  {
    // Node.js config files e scripts
    files: [
      "vite.config.js",
      "babel.config.js",
      "playwright.config.js",
      "vitest.config.js",
      "scripts/**/*.mjs",
      "scripts/**/*.js",
      "config/**/*.js",
      "config/**/*.cjs",
    ],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
      },
    },
  },
  {
    // Módulo animation usa anime.js como global injetado via CDN
    files: ["src/modules/animation/**/*.vue", "src/modules/animation/**/*.js"],
    languageOptions: {
      globals: { anime: "readonly" },
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "dev-dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "node/**",
      "src/modules/animation/dependencies/**",
      "electron/**",
    ],
  },
  eslintConfigPrettier,
];
