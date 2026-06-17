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

const migrationBlockers = [
  {
    selector: "SwitchStatement",
    message: "Effect migration blocker: use Match.exhaustive instead of switch."
  },
  {
    selector: "TryStatement",
    message: "Effect migration blocker: use Effect.try / Effect.catch* instead of try/catch."
  },
  {
    selector: "AwaitExpression",
    message: "Effect migration blocker: use Effect.gen / Effect.flatMap instead of await."
  },
  {
    selector: "FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]",
    message: "Effect migration blocker: use Effect.gen / Effect.tryPromise instead of async functions."
  },
  {
    selector: "NewExpression[callee.name='Promise']",
    message: "Effect migration blocker: use Effect.async / Effect.tryPromise instead of new Promise."
  },
  {
    selector: "CallExpression[callee.object.name='Promise']",
    message: "Effect migration blocker: use Effect combinators instead of Promise.*."
  }
]

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
    "@typescript-eslint/no-restricted-types": ["warn", {
      types: {
        Promise: {
          message: "Avoid Promise in public types. Use Effect.Effect<A, E, R>."
        },
        "Promise<*>": {
          message: "Avoid Promise<T>. Use Effect.Effect<T, E, R>."
        }
      }
    }],
    "eslint-comments/disable-enable-pair": "error",
    "eslint-comments/no-unlimited-disable": "error",
    "eslint-comments/no-unused-disable": "error",
    "eslint-comments/no-use": "error",
    "no-console": "error",
    "no-restricted-syntax": ["warn", ...migrationBlockers]
  }
})
