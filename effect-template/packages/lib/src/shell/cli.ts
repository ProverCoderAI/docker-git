import { Effect, Either, pipe } from "effect"

import { type Command, type ParseError } from "../core/domain.js"
import { parseArgs } from "../core/parser.js"

// CHANGE: read and parse CLI arguments from process.argv
// WHY: keep IO at the boundary and delegate parsing to CORE
// QUOTE(ТЗ): "Надо написать CLI команду"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall argv: read(argv) -> parse(argv)
// PURITY: SHELL
// EFFECT: Effect<Command, ParseError, never>
// INVARIANT: errors are typed as ParseError
// COMPLEXITY: O(n) where n = |argv|
export const readCommand: Effect.Effect<Command, ParseError> = pipe(
  Effect.sync(() => process.argv.slice(2)),
  Effect.map((args) => parseArgs(args)),
  Effect.flatMap((result) =>
    Either.match(result, {
      onLeft: (error) => Effect.fail(error),
      onRight: (command) => Effect.succeed(command)
    })
  )
)
