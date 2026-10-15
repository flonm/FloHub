// ESLint checks what oxlint can't yet: the rest of typescript-eslint's type-checked rules, unicorn's remaining rules,
// Storybook's rules and Mozilla's no-unsanitized. Every rule oxlint implements is switched off at the end, so
// .oxlintrc.json alone decides those, whether on or off.
// oxlint-disable-next-line import/no-unassigned-import -- it registers a module hook before typescript-eslint loads
import "./eslint-typescript.js";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import oxlint from "eslint-plugin-oxlint";
import { configs as storybook } from "eslint-plugin-storybook";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist", "dist-firefox", "storybook-static", "web-ext-artifacts", "node_modules"]),
  {
    files: ["**/*.{ts,js}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      unicorn.configs.recommended,
      noUnsanitized.configs.recommended,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
      parserOptions: { projectService: { allowDefaultProject: ["*.js", ".storybook/*.ts"] }, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" },
    rules: {
      // Same reasons as in .oxlintrc.json, for the unicorn rules oxlint doesn't have
      "unicorn/consistent-boolean-name": "off",
      "unicorn/consistent-class-member-order": "off",
      "unicorn/name-replacements": "off",
      "unicorn/no-asterisk-prefix-in-documentation-comments": "off",
      "unicorn/no-unnecessary-parameters": "off",
      "unicorn/prefer-simple-condition-first": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/single-line-block-comment-style": "off",
      // The content script keeps its state in module variables on purpose
      "unicorn/no-top-level-assignment-in-function": "off",
      // `.then(onFulfilled, onRejected)` doesn't catch errors from onFulfilled; `.then().catch()` does
      "unicorn/prefer-then-catch": "off",
      // It suggests subtracting the keys, which is wrong for the string keys FloHub sorts by
      "unicorn/prefer-simple-sort-comparator": "off",
      // Iterator helpers arrived in Firefox 131, and the manifest still lets Firefox 128 install FloHub
      "unicorn/prefer-iterator-helpers": "off",
      "unicorn/prefer-iterator-to-array": "off",
    },
  },
  {
    files: ["e2e/**", "build.ts", "*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.test.ts"],
    // Tests stand in for the extension's `chrome` global
    rules: { "unicorn/no-global-object-property-assignment": "off" },
  },
  {
    files: ["*.config.js"],
    rules: { "unicorn/no-top-level-side-effects": "off" },
  },
  storybook["flat/recommended"],
  oxlint.configs["flat/all"],
);
