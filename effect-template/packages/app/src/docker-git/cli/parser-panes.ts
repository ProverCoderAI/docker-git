import { Either } from "effect"

import { type PanesCommand, type ParseError } from "@effect-template/lib/core/domain"

import { parseProjectDirArgs } from "./parser-shared.js"

// CHANGE: parse panes command into a project selection
// WHY: allow listing tmux panes without attaching
// QUOTE(ТЗ): "покажи команду ... отобразит терминалы"
// REF: user-request-2026-02-02-panes
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parsePanes(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<PanesCommand, ParseError, never>
// INVARIANT: projectDir is never empty
// COMPLEXITY: O(n) where n = |argv|
export const parsePanes = (args: ReadonlyArray<string>): Either.Either<PanesCommand, ParseError> => {
  return Either.map(parseProjectDirArgs(args), ({ projectDir }) => ({
    _tag: "Panes",
    projectDir
  }))
}
