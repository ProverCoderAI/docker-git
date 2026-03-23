import { Effect } from "effect"
import * as Logger from "effect/Logger"

// CHANGE: capture Effect.log output so API can return it as JSON response
// WHY: lib functions communicate results via Effect.log; REST API needs string output
// PURITY: SHELL
// EFFECT: Effect<{ result: A; output: string }, E, R>
// INVARIANT: captured lines are joined with newline
// COMPLEXITY: O(n) where n = log lines
export const captureLogOutput = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<{ result: A; output: string }, E, R> => {
  const lines: string[] = []
  const captureLayer = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ message }) => {
      const text =
        typeof message === "string"
          ? message
          : Array.isArray(message)
          ? message.map(String).join(" ")
          : String(message)
      if (text.trim().length > 0) {
        lines.push(text)
      }
    })
  )
  return effect.pipe(
    Effect.provide(captureLayer),
    Effect.map((result) => ({ result, output: lines.join("\n") }))
  )
}
