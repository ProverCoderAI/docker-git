// @ts-check

// CHANGE: forbid the panel from importing BOTH the backend and the container-definition packages (issue #412)
// WHY: packages/app is the panel; container orchestration lives in @effect-template/lib (backend) and
//      container definition in @prover-coder-ai/docker-git-container. The panel must reach them only via the API client.
// REF: issue-412
const bannedPackageNames = ["@effect-template/lib", "@prover-coder-ai/docker-git-container"]
const bannedLocalAlias = "@lib"

/** @param {string} value */
const isDirectLocalAliasImport = (value) =>
  value === bannedLocalAlias || value.startsWith(`${bannedLocalAlias}/`)

/** @param {string} value */
const isRelativeLocalLibImport = (value) => /^(?:\.\.\/|\.\/)+(?:src\/)?lib(?:\/|$)/u.test(value)

/** @param {string | undefined} filePath */
const isFrontendSurfaceFile = (filePath) => {
  const normalized = (filePath ?? "").replaceAll("\\", "/")
  return normalized.startsWith("src/app/") ||
    normalized.startsWith("src/docker-git/") ||
    normalized.startsWith("src/web/") ||
    normalized.startsWith("tests/") ||
    normalized.includes("/src/app/") ||
    normalized.includes("/src/docker-git/") ||
    normalized.includes("/src/web/") ||
    normalized.includes("/tests/")
}

/**
 * @typedef {{ readonly type: "Literal", readonly value: unknown }} LiteralSourceNode
 * @typedef {{ readonly value: { readonly cooked: string | null } }} TemplateQuasiNode
 * @typedef {{
 *   readonly type: "TemplateLiteral",
 *   readonly expressions: ReadonlyArray<unknown>,
 *   readonly quasis: ReadonlyArray<TemplateQuasiNode>
 * }} TemplateLiteralSourceNode
 * @typedef {LiteralSourceNode | TemplateLiteralSourceNode} StaticSourceNode
 * @typedef {{ readonly type: "Identifier", readonly name: string }} IdentifierNode
 * @typedef {{ readonly type: "SpreadElement" }} SpreadElementNode
 */

/** @param {string} value */
const isDirectLibImport = (value) =>
  bannedPackageNames.some((name) => value === name || value.startsWith(`${name}/`))

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === "object" && value !== null

/**
 * @param {unknown} value
 * @returns {value is LiteralSourceNode}
 */
const isLiteralSourceNode = (value) =>
  isRecord(value) && value["type"] === "Literal" && "value" in value

/**
 * @param {unknown} value
 * @returns {value is TemplateLiteralSourceNode}
 */
const isTemplateLiteralSourceNode = (value) =>
  isRecord(value) &&
  value["type"] === "TemplateLiteral" &&
  Array.isArray(value["expressions"]) &&
  Array.isArray(value["quasis"])

/**
 * @param {unknown} value
 * @returns {value is IdentifierNode}
 */
const isIdentifierNode = (value) =>
  isRecord(value) && value["type"] === "Identifier" && typeof value["name"] === "string"

/**
 * @param {unknown} value
 * @returns {value is SpreadElementNode}
 */
const isSpreadElementNode = (value) =>
  isRecord(value) && value["type"] === "SpreadElement"

/** @param {unknown} source */
const readSourceText = (source) => {
  if (isLiteralSourceNode(source) && typeof source.value === "string") {
    return source.value
  }

  if (
    isTemplateLiteralSourceNode(source) &&
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
 * @returns {string}
 */
const readFilename = (context) => {
  const candidate = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (context))["getFilename"]
  if (typeof candidate === "function") {
    const filename = candidate.call(context)
    return typeof filename === "string" ? filename : ""
  }

  return "filename" in context && typeof context.filename === "string" ? context.filename : ""
}

/**
 * @param {import("eslint").Rule.RuleContext} context
 * @returns {import("eslint").Rule.RuleListener}
 */
const createRuleListener = (context) => {
  const filePath = readFilename(context)

  /** @param {unknown} source */
  const checkSource = (source) => {
    if (source == null) {
      return
    }

    const sourceText = readSourceText(source)
    if (sourceText === null) {
      return
    }

    if (isDirectLibImport(sourceText) || isDirectLocalAliasImport(sourceText)) {
      context.report({
        node: /** @type {import("eslint").JSSyntaxElement} */ (source),
        messageId: "noLibImport",
        data: { source: sourceText }
      })
      return
    }

    if (!isFrontendSurfaceFile(filePath) || !isRelativeLocalLibImport(sourceText)) {
      return
    }

    context.report({
      node: /** @type {import("eslint").JSSyntaxElement} */ (source),
      messageId: "noLibImport",
      data: { source: sourceText }
    })
  }

  return {
    /** @param {{ readonly callee?: unknown, readonly arguments?: ReadonlyArray<unknown> | null | undefined }} node */
    CallExpression(node) {
      if (
        !isIdentifierNode(node.callee) ||
        node.callee.name !== "require" ||
        !Array.isArray(node.arguments)
      ) {
        return
      }

      const [firstArgument] = node.arguments
      if (isSpreadElementNode(firstArgument)) {
        return
      }

      checkSource(firstArgument)
    },
    /** @param {{ readonly source?: unknown }} node */
    ExportAllDeclaration(node) {
      checkSource(node.source)
    },
    /** @param {{ readonly source?: unknown }} node */
    ExportNamedDeclaration(node) {
      checkSource(node.source)
    },
    /** @param {{ readonly source?: unknown }} node */
    ImportDeclaration(node) {
      checkSource(node.source)
    },
    /** @param {{ readonly source?: unknown }} node */
    ImportExpression(node) {
      checkSource(node.source)
    },
    /** @param {{ readonly source?: unknown, readonly argument?: unknown }} node */
    TSImportType(node) {
      checkSource("source" in node ? node.source : node.argument)
    },
    /** @param {{ readonly expression?: unknown }} node */
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
        "forbid direct imports, re-exports, and require calls from the backend (@effect-template/lib) or container-definition (@prover-coder-ai/docker-git-container) packages inside package/app frontend surfaces and tests"
    },
    schema: [],
    messages: {
      noLibImport:
        "Direct import or require '{{source}}' from the backend (@effect-template/lib) or container-definition (@prover-coder-ai/docker-git-container) packages is forbidden in package/app frontend surfaces and tests. Use the API client or a local app adapter instead."
    }
  },
  create: createRuleListener
}
