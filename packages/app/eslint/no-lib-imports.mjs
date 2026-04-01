// @ts-check

const bannedPackageName = "@effect-template/lib"

/** @param {string} value */
const isDirectLibImport = (value) =>
  value === bannedPackageName || value.startsWith(`${bannedPackageName}/`)

/** @param {(import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined} source */
const readSourceText = (source) => {
  if (source == null) {
    return null
  }

  if (source.type === "Literal" && typeof source.value === "string") {
    return source.value
  }

  if (
    source.type === "TemplateLiteral" &&
    source.expressions.length === 0 &&
    source.quasis.length === 1
  ) {
    const [quasi] = source.quasis
    return typeof quasi?.value.cooked === "string" ? quasi.value.cooked : null
  }

  return null
}

/**
 * @param {import("eslint").Rule.RuleContext} context
 * @returns {import("eslint").Rule.RuleListener}
 */
const createRuleListener = (context) => {
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
    /** @param {{ readonly callee?: import("eslint").JSSyntaxElement | null | undefined, readonly arguments?: ReadonlyArray<import("eslint").JSSyntaxElement | import("eslint").SpreadElement> | null | undefined }} node */
    CallExpression(node) {
      if (
        node.callee?.type !== "Identifier" ||
        node.callee.name !== "require" ||
        !Array.isArray(node.arguments)
      ) {
        return
      }

      const [firstArgument] = node.arguments
      if (firstArgument?.type === "SpreadElement") {
        return
      }

      checkSource(firstArgument)
    },
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
    },
    /** @param {{ readonly expression?: (import("eslint").JSSyntaxElement & { readonly value?: unknown }) | null | undefined }} node */
    TSExternalModuleReference(node) {
      checkSource(node.expression)
    }
  }
}

/** @type {import("eslint").Rule.RuleModule} */
export const noLibImportsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "forbid direct imports, re-exports, and require calls from @effect-template/lib inside package/app"
    },
    schema: [],
    messages: {
      noLibImport:
        "Direct import or require '{{source}}' from @effect-template/lib is forbidden in package/app. Use the API client or a local app adapter instead."
    }
  },
  create: createRuleListener
}
