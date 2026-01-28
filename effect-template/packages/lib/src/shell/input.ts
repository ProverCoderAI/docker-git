import { Effect } from "effect"
import * as readline from "node:readline"

import { InputCancelledError, InputReadError } from "./errors.js"

const restoreRawMode = (wasRaw: boolean) => {
  if (process.stdin.isTTY && wasRaw) {
    process.stdin.setRawMode(true)
  }
}

const setupInterface = () =>
  Effect.try({
    try: () => {
      const stdin = process.stdin
      const stdout = process.stdout
      const wasRaw = stdin.isTTY && stdin.isRaw

      if (stdin.isTTY && stdin.isRaw) {
        stdin.setRawMode(false)
      }

      const rl = readline.createInterface({
        input: stdin,
        output: stdout,
        terminal: stdin.isTTY
      })

      return { rl, wasRaw }
    },
    catch: (error) =>
      new InputReadError({
        message: error instanceof Error ? error.message : String(error)
      })
  })

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
export const promptLine = (prompt: string): Effect.Effect<string, InputCancelledError | InputReadError> =>
  Effect.flatMap(
    setupInterface(),
    ({ rl, wasRaw }) =>
      Effect.async<string, InputCancelledError | InputReadError>((resume) => {
        let closed = false

        const cleanup = () => {
          if (closed) {
            return
          }
          closed = true
          rl.close()
          restoreRawMode(wasRaw)
        }

        const onSigint = () => {
          cleanup()
          resume(Effect.fail(new InputCancelledError({})))
        }

        rl.once("SIGINT", onSigint)
        rl.question(prompt, (answer: string) => {
          rl.off("SIGINT", onSigint)
          cleanup()
          resume(Effect.succeed(answer))
        })

        return Effect.sync(() => {
          rl.off("SIGINT", onSigint)
          cleanup()
        })
      })
  )
