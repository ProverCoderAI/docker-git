import { Effect } from "effect"
import { writeSync } from "node:fs"
import * as Readline from "node:readline"

import { AuthError } from "../shell/errors.js"

export const readVisibleLine = (prompt: string): Effect.Effect<string, AuthError> =>
  Effect.async<string, AuthError>((resume) => {
    // We intentionally use readline (not raw mode) so paste works reliably in common terminals.
    const hasRawMode = process.stdin.isTTY && typeof process.stdin.setRawMode === "function"
    const previousRaw = hasRawMode ? process.stdin.isRaw : undefined
    if (hasRawMode) {
      process.stdin.setRawMode(false)
    }

    const rl = Readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    })

    let settled = false
    const cleanup = () => {
      rl.removeAllListeners()
      rl.close()
      if (hasRawMode && previousRaw !== undefined) {
        process.stdin.setRawMode(previousRaw)
      }
    }

    rl.on("SIGINT", () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resume(Effect.fail(new AuthError({ message: "Claude auth login cancelled." })))
    })

    writeSync(1, prompt)
    rl.question("", (answer) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resume(Effect.succeed(answer))
    })

    return Effect.sync(() => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
    })
  })
