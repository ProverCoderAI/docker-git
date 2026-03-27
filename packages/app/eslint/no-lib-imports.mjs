// @ts-check

const bannedPackageName = "@effect-template/lib"

/** @type {ReadonlyArray<string>} */
export const appLegacyLibImportAllowlist = [
  "src/app/program.ts",
  "src/docker-git/cli/input.ts",
  "src/docker-git/cli/parser-apply.ts",
  "src/docker-git/cli/parser-attach.ts",
  "src/docker-git/cli/parser-auth.ts",
  "src/docker-git/cli/parser-clone.ts",
  "src/docker-git/cli/parser-create.ts",
  "src/docker-git/cli/parser-mcp-playwright.ts",
  "src/docker-git/cli/parser-options.ts",
  "src/docker-git/cli/parser-panes.ts",
  "src/docker-git/cli/parser-scrap.ts",
  "src/docker-git/cli/parser-session-gists.ts",
  "src/docker-git/cli/parser-sessions.ts",
  "src/docker-git/cli/parser-shared.ts",
  "src/docker-git/cli/parser-state.ts",
  "src/docker-git/cli/parser.ts",
  "src/docker-git/cli/read-command.ts",
  "src/docker-git/cli/usage.ts",
  "src/docker-git/menu-actions.ts",
  "src/docker-git/menu-auth-data.ts",
  "src/docker-git/menu-auth-effects.ts",
  "src/docker-git/menu-auth-helpers.ts",
  "src/docker-git/menu-auth-snapshot-builder.ts",
  "src/docker-git/menu-auth.ts",
  "src/docker-git/menu-create.ts",
  "src/docker-git/menu-labeled-env.ts",
  "src/docker-git/menu-menu.ts",
  "src/docker-git/menu-project-auth-data.ts",
  "src/docker-git/menu-project-auth-flows.ts",
  "src/docker-git/menu-project-auth.ts",
  "src/docker-git/menu-render-select.ts",
  "src/docker-git/menu-render.ts",
  "src/docker-git/menu-select-actions.ts",
  "src/docker-git/menu-select-connect.ts",
  "src/docker-git/menu-select-load.ts",
  "src/docker-git/menu-select-order.ts",
  "src/docker-git/menu-select-runtime.ts",
  "src/docker-git/menu-select-view.ts",
  "src/docker-git/menu-startup.ts",
  "src/docker-git/menu-types.ts",
  "src/docker-git/menu.ts",
  "src/docker-git/program.ts",
  "src/docker-git/tmux.ts",
  "tests/docker-git/entrypoint-auth.test.ts",
  "tests/docker-git/fixtures/project-item.ts",
  "tests/docker-git/menu-select-connect.test.ts",
  "tests/docker-git/parser-helpers.ts",
  "tests/docker-git/parser.test.ts"
]

/** @param {string} value */
const normalizePath = (value) => value.replaceAll("\\", "/")

/** @param {string} value */
const isDirectLibImport = (value) =>
  value === bannedPackageName || value.startsWith(`${bannedPackageName}/`)

/**
 * @param {string} filename
 * @param {ReadonlyArray<string>} allowInFiles
 */
const isAllowlistedFile = (filename, allowInFiles) => {
  const normalized = normalizePath(filename)
  return allowInFiles.some((entry) => normalized === entry || normalized.endsWith(`/${entry}`))
}

/** @param {(import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined} source */
const readSourceText = (source) =>
  source && source.type === "Literal" && typeof source.value === "string"
    ? source.value
    : null

/**
 * @param {import("eslint").Rule.RuleContext} context
 * @returns {import("eslint").Rule.RuleListener}
 */
const createRuleListener = (context) => {
  const [options = {}] = context.options
  const allowInFiles = Array.isArray(options.allowInFiles)
    ? options.allowInFiles.map(
        /** @param {unknown} value */ (value) => normalizePath(String(value))
      )
    : []
  const filename = typeof context.filename === "string" ? context.filename : ""

  if (isAllowlistedFile(filename, allowInFiles)) {
    return {}
  }

  /** @param {(import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined} source */
  const checkSource = (source) => {
    if (source == null) {
      return
    }

    const sourceText = readSourceText(source)
    if (sourceText === null || !isDirectLibImport(sourceText)) {
      return
    }

    context.report({
      node: source,
      messageId: "noLibImport",
      data: { source: sourceText }
    })
  }

  return {
    /** @param {{ readonly source?: (import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined }} node */
    ExportAllDeclaration(node) {
      checkSource(node.source)
    },
    /** @param {{ readonly source?: (import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined }} node */
    ExportNamedDeclaration(node) {
      checkSource(node.source)
    },
    /** @param {{ readonly source?: (import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined }} node */
    ImportDeclaration(node) {
      checkSource(node.source)
    },
    /** @param {{ readonly source?: (import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined }} node */
    ImportExpression(node) {
      checkSource(node.source)
    },
    /** @param {{ readonly source?: (import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined, readonly argument?: (import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined }} node */
    TSImportType(node) {
      checkSource("source" in node ? node.source : node.argument)
    }
  }
}

/** @type {import("eslint").Rule.RuleModule} */
export const noLibImportsRule = {
  meta: {
    type: "problem",
    docs: {
      description: "forbid direct imports from @effect-template/lib inside package/app"
    },
    schema: [
      {
        type: "object",
        properties: {
          allowInFiles: {
            type: "array",
            items: { type: "string" }
          }
        },
        additionalProperties: false
      }
    ],
    messages: {
      noLibImport:
        "Direct import '{{source}}' from @effect-template/lib is forbidden in package/app. Use the API client or a local app adapter instead."
    }
  },
  create: createRuleListener
}
