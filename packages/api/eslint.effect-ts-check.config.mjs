// CHANGE: add API-local Effect-TS compliance lint profile.
// WHY: expose Effect migration blockers in the API package, which previously only ran baseline ESLint.
// QUOTE(TZ): "packages/api не защищён lint:effect"
// REF: user-request-2026-06-17-effect-compliance-api
// SOURCE: n/a
// FORMAT THEOREM: lint(api) = hard unsafe bypass errors + visible Effect migration blockers
// PURITY: SHELL
// EFFECT: eslint config
// INVARIANT: config does not alter runtime behavior.
// COMPLEXITY: O(1)/O(1)
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments"
import globals from "globals"
import tseslint from "typescript-eslint"

import { effectMigrationWarnings, effectPromiseRestrictedTypes } from "../../eslint.effect-ts-shared.mjs"

export default tseslint.config({
  name: "api-effect-ts-compliance",
  files: ["src/**/*.ts", "tests/**/*.ts"],
  languageOptions: {
    parser: tseslint.parser,
    globals: { ...globals.node }
  },
  plugins: {
    "@typescript-eslint": tseslint.plugin,
    "eslint-comments": eslintComments
  },
  rules: {
    "@typescript-eslint/ban-ts-comment": ["error", {
      "ts-check": false,
      "ts-expect-error": true,
      "ts-ignore": true,
      "ts-nocheck": true
    }],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-restricted-types": ["warn", effectPromiseRestrictedTypes],
    "eslint-comments/disable-enable-pair": "error",
    "eslint-comments/no-unlimited-disable": "error",
    "eslint-comments/no-unused-disable": "error",
    "eslint-comments/no-use": "error",
    "no-console": "error",
    "no-restricted-syntax": ["warn", ...effectMigrationWarnings]
  }
})
