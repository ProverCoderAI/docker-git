import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import { ensureTerminalCursorVisible } from "../../src/usecases/terminal-cursor.js"

type TtyPatch = {
  readonly prevStdinTty: boolean | undefined
  readonly prevStdoutTty: boolean | undefined
}

const patchTty = (stdinTty: boolean, stdoutTty: boolean): Effect.Effect<TtyPatch, never> =>
  Effect.sync(() => {
    const prevStdinTty = process.stdin.isTTY
    const prevStdoutTty = process.stdout.isTTY
    Object.defineProperty(process.stdin, "isTTY", { value: stdinTty, configurable: true })
    Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true })
    return { prevStdinTty, prevStdoutTty }
  })

const restoreTty = (patch: TtyPatch): Effect.Effect<void, never> =>
  Effect.sync(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: patch.prevStdinTty, configurable: true })
    Object.defineProperty(process.stdout, "isTTY", { value: patch.prevStdoutTty, configurable: true })
  })

const withPatchedTty = <A, E, R>(
  stdinTty: boolean,
  stdoutTty: boolean,
  use: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(patchTty(stdinTty, stdoutTty), restoreTty).pipe(
      Effect.flatMap(() => use)
    )
  )

describe("ensureTerminalCursorVisible", () => {
  it.effect("emits show-cursor escape in interactive tty", () =>
    Effect.gen(function*(_) {
      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
      try {
        yield* _(withPatchedTty(true, true, ensureTerminalCursorVisible()))
        expect(writeSpy).toHaveBeenCalledWith("\u001B[?25h")
      } finally {
        writeSpy.mockRestore()
      }
    }))

  it.effect("does nothing in non-interactive mode", () =>
    Effect.gen(function*(_) {
      const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
      try {
        yield* _(withPatchedTty(false, true, ensureTerminalCursorVisible()))
        expect(writeSpy).not.toHaveBeenCalled()
      } finally {
        writeSpy.mockRestore()
      }
    }))
})
