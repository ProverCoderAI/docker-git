import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

const {
  closeSyncMock,
  openSyncMock,
  spawnSyncMock,
  writeSyncMock
} = vi.hoisted(() => ({
  closeSyncMock: vi.fn(),
  openSyncMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  writeSyncMock: vi.fn()
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    openSync: openSyncMock,
    closeSync: closeSyncMock,
    writeSync: writeSyncMock
  }
})

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process")
  return {
    ...actual,
    spawnSync: spawnSyncMock
  }
})

import { ensureTerminalCursorVisible, withPreservedTerminalState } from "../../src/usecases/terminal-cursor.js"

type TtyPatch = {
  readonly prevStdinTty: boolean | undefined
  readonly prevStdoutTty: boolean | undefined
}

const terminalEscape =
  "\u001B[0m\u001B[?25h\u001B[?1l\u001B>\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1005l\u001B[?1006l" +
  "\u001B[?1015l\u001B[?1007l\u001B[?1004l\u001B[?2004l\u001B[>4;0m\u001B[>4m\u001B[<u"

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

beforeEach(() => {
  openSyncMock.mockReset()
  closeSyncMock.mockReset()
  writeSyncMock.mockReset()
  spawnSyncMock.mockReset()
  closeSyncMock.mockImplementation(() => undefined)
  writeSyncMock.mockImplementation(() => terminalEscape.length)
})

describe("ensureTerminalCursorVisible", () => {
  it.effect("falls back to stdout when /dev/tty is unavailable", () =>
    withWriteSpy((stdoutWriteSpy) =>
      Effect.gen(function*(_) {
        openSyncMock.mockImplementation(() => {
          throw new Error("tty unavailable")
        })

        yield* _(withPatchedTty(true, true, ensureTerminalCursorVisible()))

        expect(spawnSyncMock).not.toHaveBeenCalled()
        expect(stdoutWriteSpy).toHaveBeenCalledWith(terminalEscape)
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

describe("withPreservedTerminalState", () => {
  it.effect("captures and restores the controlling tty around interactive ssh", () =>
    Effect.gen(function*(_) {
      openSyncMock.mockReturnValue(42)
      spawnSyncMock
        .mockReturnValueOnce({
          pid: 1,
          output: [],
          stdout: "saved-state\n",
          stderr: "",
          status: 0,
          signal: null
        })
        .mockReturnValueOnce({
          pid: 1,
          output: [],
          stdout: "",
          stderr: "",
          status: 0,
          signal: null
        })
        .mockReturnValueOnce({
          pid: 1,
          output: [],
          stdout: "",
          stderr: "",
          status: 0,
          signal: null
        })

      yield* _(withPatchedTty(true, true, withPreservedTerminalState(Effect.void)))

      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        1,
        "stty",
        ["-g"],
        expect.objectContaining({ encoding: "utf8", stdio: [42, "pipe", "ignore"] })
      )
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        2,
        "stty",
        ["sane"],
        expect.objectContaining({ encoding: "utf8", stdio: [42, "ignore", "ignore"] })
      )
      expect(spawnSyncMock).toHaveBeenNthCalledWith(
        3,
        "stty",
        ["saved-state"],
        expect.objectContaining({ encoding: "utf8", stdio: [42, "ignore", "ignore"] })
      )
      expect(writeSyncMock).toHaveBeenCalledWith(42, terminalEscape)
    }))
})
