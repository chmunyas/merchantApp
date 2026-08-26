import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "*.gen.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Ratchet: these are at zero violations today, so they are errors and can
      // never regress. `label-has-associated-control` has 74 existing offenders
      // (see BACKLOG) and stays a warning until they are fixed, then promotes.
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/no-redundant-roles": "error",
      // Promoted: autoFocus moves focus before the user has oriented, and there
      // are now zero offenders. Do not reintroduce it — focus a step's heading
      // deliberately instead.
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/label-has-associated-control": "warn",
      // Promoted: the modal-overlay debt these tracked is paid off. Every
      // click-outside-to-close surface now goes through <ModalOverlay>, which
      // makes the backdrop a real button and adds Escape-to-close. If you need
      // a click handler on a div, you almost certainly want a <button> instead.
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
);
