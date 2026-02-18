import { Either } from "effect"

import { type McpPlaywrightUpCommand, type ParseError } from "@effect-template/lib/core/domain"

import { parseProjectDirWithOptions } from "./parser-shared.js"

// CHANGE: parse "mcp-playwright" command for existing docker-git projects
// WHY: allow enabling Playwright MCP in an already created container/project dir
// QUOTE(ТЗ): "Добавить возможность поднимать MCP Playrgiht в контейнере который уже создан"
// REF: issue-29
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseMcpPlaywright(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<McpPlaywrightUpCommand, ParseError, never>
// INVARIANT: projectDir is never empty
// COMPLEXITY: O(n) where n = |argv|
export const parseMcpPlaywright = (
  args: ReadonlyArray<string>
): Either.Either<McpPlaywrightUpCommand, ParseError> =>
  Either.map(parseProjectDirWithOptions(args), ({ projectDir, raw }) => ({
    _tag: "McpPlaywrightUp",
    projectDir,
    runUp: raw.up ?? true
  }))
