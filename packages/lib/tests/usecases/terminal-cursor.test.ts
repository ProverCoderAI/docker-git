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

const withWriteSpy = <A, E, R>(
  use: (writeSpy: ReturnType<typeof vi.spyOn>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() => vi.spyOn(process.stdout, "write").mockImplementation(() => true)),
      (writeSpy) =>
        Effect.sync(() => {
          writeSpy.mockRestore()
        })
    ).pipe(
      Effect.flatMap((writeSpy) => use(writeSpy))
    )
  )

describe("ensureTerminalCursorVisible", () => {
  it.effect("emits show-cursor escape in interactive tty", () =>
    withWriteSpy((writeSpy) =>
      Effect.gen(function*(_) {
        yield* _(withPatchedTty(true, true, ensureTerminalCursorVisible()))
        expect(writeSpy).toHaveBeenCalledWith("\u001B[?25h")
      })
    ))

  it.effect("does nothing in non-interactive mode", () =>
    withWriteSpy((writeSpy) =>
      Effect.gen(function*(_) {
        yield* _(withPatchedTty(false, true, ensureTerminalCursorVisible()))
        expect(writeSpy).not.toHaveBeenCalled()
      })
    ))
})
