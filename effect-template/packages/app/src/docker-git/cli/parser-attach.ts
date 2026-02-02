import { Either } from "effect"

import { type AttachCommand, type ParseError } from "@effect-template/lib/core/domain"

import { parseProjectDirArgs } from "./parser-shared.js"

// CHANGE: parse attach command into a project selection
// WHY: allow "docker-git attach" to open a tmux workspace
// QUOTE(ТЗ): "окей Давай подключим tmux"
// REF: user-request-2026-02-02-tmux
// SOURCE: n/a
// FORMAT THEOREM: forall argv: parseAttach(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: Effect<AttachCommand, ParseError, never>
// INVARIANT: projectDir is never empty
// COMPLEXITY: O(n) where n = |argv|
export const parseAttach = (args: ReadonlyArray<string>): Either.Either<AttachCommand, ParseError> => {
  return Either.map(parseProjectDirArgs(args), ({ projectDir }) => ({
    _tag: "Attach",
    projectDir
  }))
}
