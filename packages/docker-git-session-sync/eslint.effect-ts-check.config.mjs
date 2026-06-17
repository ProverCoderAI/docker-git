// CHANGE: Add a package-local Effect-TS compliance scan.
// WHY: This package is mid-migration; hard failures catch unsafe bypasses while warnings expose remaining shell blockers.
// QUOTE(TZ): "добавить package deps/scripts/config"
// REF: user-request-2026-06-17-effect-compliance-session-sync
// SOURCE: n/a
// FORMAT THEOREM: findings(src) = errors(unsafe bypasses) ∪ warnings(effect migration blockers)
// PURITY: SHELL
// EFFECT: eslint config
// INVARIANT: lint configuration does not change runtime behavior.
// COMPLEXITY: O(1)/O(1)
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments"
import globals from "globals"
import tseslint from "typescript-eslint"

const effectMigrationWarnings = [
  {
    selector: "TryStatement",
    message: "Effect migration blocker: replace try/catch with Effect.try / Effect.catch* at shell boundaries."
  },
  {
    selector: "SwitchStatement",
    message: "Effect migration blocker: use Match.exhaustive instead of switch."
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
  name: "docker-git-session-sync-effect-ts-compliance",
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
    "@typescript-eslint/no-restricted-types": ["error", {
      types: {
        Promise: {
          message: "Avoid Promise in public types. Use Effect.Effect<A, E, R>."
        },
        "Promise<*>": {
          message: "Avoid Promise<T>. Use Effect.Effect<A, E, R>."
        }
      }
    }],
    "eslint-comments/disable-enable-pair": "error",
    "eslint-comments/no-unlimited-disable": "error",
    "eslint-comments/no-unused-disable": "error",
    "eslint-comments/no-use": "error",
    "no-console": "error",
    "no-restricted-syntax": ["warn", ...effectMigrationWarnings]
  }
})
