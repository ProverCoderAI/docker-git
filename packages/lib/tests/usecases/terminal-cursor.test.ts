import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, pipe } from "effect"
import * as Stream from "effect/Stream"

import { ensureTerminalCursorVisible, withPreservedTerminalState } from "../../src/usecases/terminal-cursor.js"

type TtyPatch = {
  readonly prevSetRawMode: typeof process.stdin.setRawMode
  readonly prevStdinTty: boolean | undefined
  readonly prevStdoutTty: boolean | undefined
}

const terminalEscape =
  "\u001B[0m\u001B[?25h\u001B[?1l\u001B>\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1005l\u001B[?1006l" +
  "\u001B[?1015l\u001B[?1007l\u001B[?1004l\u001B[?2004l\u001B[>4;0m\u001B[>4m\u001B[<u"

const commandLabel = (command: Command.Command): string => {
  const standard = Command.flatten(command)[0]
  const script = standard.args.at(1) ?? ""
  if (script.includes("-g")) {
    return "stty:-g"
  }
  if (script.includes("stty '")) {
    return "stty:restore"
  }
  if (script.includes("sane")) {
    return "stty:sane"
  }
  return standard.command
}

const makeSetRawMode = (events: Array<string>): typeof process.stdin.setRawMode =>
  function setRawModeStub(enabled: boolean) {
    events.push(`raw:${String(enabled)}`)
    return this
  }

const patchTty = (events: Array<string>, stdinTty: boolean, stdoutTty: boolean): Effect.Effect<TtyPatch> =>
  Effect.sync(() => {
    const prevSetRawMode = process.stdin.setRawMode
    const prevStdinTty = process.stdin.isTTY
    const prevStdoutTty = process.stdout.isTTY
    Object.defineProperty(process.stdin, "isTTY", { value: stdinTty, configurable: true })
    Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true })
    Object.defineProperty(process.stdin, "setRawMode", { value: makeSetRawMode(events), configurable: true })
    return { prevSetRawMode, prevStdinTty, prevStdoutTty }
  })

const restoreTty = (patch: TtyPatch): Effect.Effect<void> =>
  Effect.sync(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: patch.prevStdinTty, configurable: true })
    Object.defineProperty(process.stdout, "isTTY", { value: patch.prevStdoutTty, configurable: true })
    Object.defineProperty(process.stdin, "setRawMode", { value: patch.prevSetRawMode, configurable: true })
  })

const makeCommandExecutor = (events: Array<string>): CommandExecutor.CommandExecutor => ({
  [CommandExecutor.TypeId]: CommandExecutor.TypeId,
  exitCode: (command) =>
    Effect.sync(() => {
      events.push(`exit:${commandLabel(command)}`)
      return CommandExecutor.ExitCode(0)
    }),
  lines: (command) =>
    Effect.sync(() => {
      events.push(`lines:${commandLabel(command)}`)
      return ["saved-state"]
    }),
  start: () => Effect.dieMessage("terminal-cursor tests do not start processes"),
  stream: () => Stream.empty,
  streamLines: () => Stream.empty,
  string: (command) =>
    Effect.sync(() => {
      events.push(`string:${commandLabel(command)}`)
      return "1:2:3:4\n"
    })
})

const withTerminalServices = <A, E, R>(
  events: Array<string>,
  use: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const fakeFs: FileSystem.FileSystem = {
      ...fs,
      writeFileString: (path, data) =>
        Effect.sync(() => {
          events.push(data === terminalEscape ? `write:${path}:terminal-reset` : `write:${path}`)
        })
    }

    return yield* _(
      use.pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, makeCommandExecutor(events)),
        Effect.provideService(FileSystem.FileSystem, fakeFs)
      )
    )
  }).pipe(Effect.provide(NodeContext.layer))

const withPatchedTty = <A, E, R>(
  events: Array<string>,
  stdinTty: boolean,
  stdoutTty: boolean,
  use: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(patchTty(events, stdinTty, stdoutTty), restoreTty).pipe(
      Effect.flatMap(() => withTerminalServices(events, use))
    )
  )

describe("ensureTerminalCursorVisible", () => {
  it.effect("repairs and resets an interactive terminal", () =>
    Effect.gen(function*(_) {
      const events: Array<string> = []
      yield* _(withPatchedTty(events, true, true, Effect.suspend(() => ensureTerminalCursorVisible())))

      expect(events).toEqual([
        "raw:false",
        "exit:stty:sane",
        "write:/dev/tty:terminal-reset"
      ])
    }))

  it.effect("does nothing in non-interactive mode", () =>
    Effect.gen(function*(_) {
      const events: Array<string> = []
      yield* _(withPatchedTty(events, false, true, ensureTerminalCursorVisible()))
      expect(events).toEqual([])
    }))
})

describe("withPreservedTerminalState", () => {
  it.effect("captures and restores the controlling tty around interactive ssh", () =>
    Effect.gen(function*(_) {
      const events: Array<string> = []
      yield* _(
        withPatchedTty(
          events,
          true,
          true,
          withPreservedTerminalState(
            Effect.sync(() => {
              events.push("effect:ssh")
            })
          )
        )
      )

      expect(events).toEqual([
        "raw:false",
        "string:stty:-g",
        "raw:false",
        "exit:stty:sane",
        "write:/dev/tty:terminal-reset",
        "effect:ssh",
        "raw:false",
        "exit:stty:restore",
        "write:/dev/tty:terminal-reset"
      ])
    }))
})
