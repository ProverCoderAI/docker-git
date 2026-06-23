import { Either } from "effect"

import { type McpAndroidUpCommand, type ParseError } from "../frontend-lib/core/domain.js"

import { parseProjectDirWithOptions } from "./parser-shared.js"

// CHANGE: parse "mcp-android" command for existing docker-git projects
// WHY: allow enabling Android MCP in an already created container/project dir
// QUOTE(ТЗ): "Подключить mcp-android так же как работает MCP PLAYRIGHT"
// REF: issue-436
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseMcpAndroid(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<McpAndroidUpCommand, ParseError, never>
// INVARIANT: projectDir is never empty
// COMPLEXITY: O(n) where n = |argv|
export const parseMcpAndroid = (
  args: ReadonlyArray<string>
): Either.Either<McpAndroidUpCommand, ParseError> =>
  Either.map(parseProjectDirWithOptions(args), ({ projectDir, raw }) => ({
    _tag: "McpAndroidUp",
    projectDir,
    runUp: raw.up ?? true
  }))
