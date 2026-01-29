import * as Terminal from "@effect/platform/Terminal"
import { Effect } from "effect"

import { InputCancelledError, InputReadError } from "./errors.js"

const normalizeMessage = (error: Error): string => error.message

const toReadError = (error: Error): InputReadError => new InputReadError({ message: normalizeMessage(error) })

const mapReadLineError = (_error: Terminal.QuitException): InputCancelledError => new InputCancelledError({})

// CHANGE: prompt for a single line of user input
// WHY: provide an interactive CLI without raw terminal mode issues
// QUOTE(ТЗ): "Хочу что бы открылось менюшка"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall p: prompt(p) -> line(p)
// PURITY: SHELL
// EFFECT: Effect<string, InputCancelledError | InputReadError, never>
// INVARIANT: restores raw mode if it was enabled before prompting
// COMPLEXITY: O(1)
export const promptLine = (
  prompt: string
): Effect.Effect<string, InputCancelledError | InputReadError, Terminal.Terminal> =>
  Effect.gen(function*(_) {
    const terminal = yield* _(Terminal.Terminal)
    yield* _(terminal.display(prompt).pipe(Effect.mapError(toReadError)))
    return yield* _(terminal.readLine.pipe(Effect.mapError(mapReadLineError)))
  })
