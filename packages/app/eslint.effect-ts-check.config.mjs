// CHANGE: add Effect-TS compliance lint profile
// WHY: detect current deviations from strict Effect-TS guidance
// QUOTE(TZ): n/a
// REF: AGENTS.md Effect-TS compliance checks
// SOURCE: n/a
// PURITY: SHELL
// EFFECT: eslint config
// INVARIANT: config only flags explicit policy deviations
// COMPLEXITY: O(1)/O(1)
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments"
import globals from "globals"
import tseslint from "typescript-eslint"

const restrictedImports = [
  {
    name: "node:fs",
    message: "Use @effect/platform FileSystem instead of node:fs."
  },
  {
    name: "fs",
    message: "Use @effect/platform FileSystem instead of fs."
  },
  {
    name: "node:fs/promises",
    message: "Use @effect/platform FileSystem instead of node:fs/promises."
  },
  {
    name: "node:path/posix",
    message: "Use @effect/platform Path instead of node:path/posix."
  },
  {
    name: "node:path",
    message: "Use @effect/platform Path instead of node:path."
  },
  {
    name: "path",
    message: "Use @effect/platform Path instead of path."
  },
  {
    name: "node:child_process",
    message: "Use @effect/platform Command instead of node:child_process."
  },
  {
    name: "child_process",
    message: "Use @effect/platform Command instead of child_process."
  },
  {
    name: "node:process",
    message: "Use @effect/platform Runtime instead of node:process."
  },
  {
    name: "process",
    message: "Use @effect/platform Runtime instead of process."
  }
]

const restrictedSyntaxBase = [
  {
    selector: "SwitchStatement",
    message: "Switch is forbidden. Use Match.exhaustive."
  },
  {
    selector: "TryStatement",
    message: "Avoid try/catch in product code. Use Effect.try / Effect.catch*."
  },
  {
    selector: "AwaitExpression",
    message: "Avoid await. Use Effect.gen / Effect.flatMap."
  },
  {
    selector: "FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]",
    message: "Avoid async/await. Use Effect.gen / Effect.tryPromise."
  },
  {
    selector: "NewExpression[callee.name='Promise']",
    message: "Avoid new Promise. Use Effect.async / Effect.tryPromise."
  },
  {
    selector: "CallExpression[callee.object.name='Promise']",
    message: "Avoid Promise.*. Use Effect combinators."
  },
  {
    selector: "CallExpression[callee.name='require']",
    message: "Avoid require(). Use ES module imports."
  },
  {
    selector: "TSAsExpression",
    message: "Casting is only allowed in src/core/axioms.ts."
  },
  {
    selector: "TSTypeAssertion",
    message: "Casting is only allowed in src/core/axioms.ts."
  },
  {
    selector: "CallExpression[callee.name='makeFilesystemService']",
    message: "Do not instantiate FilesystemService directly. Provide Layer and access via Tag."
  },
  {
    selector: "CallExpression[callee.property.name='catchAll']",
    message: "Avoid catchAll that discards typed errors; map or propagate explicitly."
  }
]

const restrictedSyntaxCore = [
  ...restrictedSyntaxBase,
  {
    selector: "TSUnknownKeyword",
    message: "unknown is allowed only at shell boundaries with decoding."
  },
  {
    selector: "CallExpression[callee.property.name='runSyncExit']",
    message: "Effect.runSyncExit is shell-only. Move to a runner."
  },
  {
    selector: "CallExpression[callee.property.name='runSync']",
    message: "Effect.runSync is shell-only. Move to a runner."
  },
  {
    selector: "CallExpression[callee.property.name='runPromise']",
    message: "Effect.runPromise is shell-only. Move to a runner."
  }
]

const restrictedSyntaxCoreNoAs = [
  ...restrictedSyntaxCore.filter((rule) =>
    rule.selector !== "TSAsExpression" && rule.selector !== "TSTypeAssertion"
  )
]

const restrictedSyntaxBaseNoServiceFactory = [
  ...restrictedSyntaxBase.filter((rule) =>
    rule.selector !== "CallExpression[callee.name='makeFilesystemService']"
  )
]

export default tseslint.config(
  {
    name: "effect-ts-compliance-check",
    files: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      globals: { ...globals.node }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "eslint-comments": eslintComments
    },
    rules: {
      "no-console": "error",
      "no-restricted-imports": ["error", {
        paths: restrictedImports,
        patterns: [
          {
            group: ["node:*"],
            message: "Do not import from node:* directly. Use @effect/platform-node or @effect/platform services."
          }
        ]
      }],
      "no-restricted-syntax": ["error", ...restrictedSyntaxBase],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-ignore": true,
        "ts-nocheck": true,
        "ts-check": false,
        "ts-expect-error": true
      }],
      "@typescript-eslint/no-restricted-types": ["error", {
        types: {
          Promise: {
            message: "Avoid Promise in types. Use Effect.Effect<A, E, R>."
          },
          "Promise<*>": {
            message: "Avoid Promise<T>. Use Effect.Effect<T, E, R>."
          }
        }
      }],
      "eslint-comments/no-use": "error",
      "eslint-comments/no-unlimited-disable": "error",
      "eslint-comments/disable-enable-pair": "error",
      "eslint-comments/no-unused-disable": "error"
    }
  },
  {
    name: "effect-ts-compliance-core",
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntaxCore],
      "no-restricted-imports": ["error", {
        paths: restrictedImports,
        patterns: [
          {
            group: [
              "../shell/**",
              "../../shell/**",
              "../../../shell/**",
              "./shell/**",
              "src/shell/**",
              "shell/**"
            ],
            message: "CORE must not import from SHELL."
          }
        ]
      }]
    }
  },
  {
    name: "effect-ts-compliance-axioms",
    files: ["src/core/axioms.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntaxCoreNoAs]
    }
  },
  {
    name: "effect-ts-compliance-filesystem-service",
    files: ["src/shell/services/filesystem.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntaxBaseNoServiceFactory]
    }
  }
)
