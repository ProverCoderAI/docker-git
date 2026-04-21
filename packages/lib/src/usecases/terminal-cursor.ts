import * as Command from "@effect/platform/Command"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import { Effect, Option, pipe } from "effect"

const terminalSaneEscape = "\u001B[0m" + // reset rendition
  "\u001B[?25h" + // show cursor
  "\u001B[?1l" + // normal cursor keys mode
  "\u001B>" + // normal keypad mode
  "\u001B[?1000l" + // disable mouse click tracking
  "\u001B[?1002l" + // disable mouse drag tracking
  "\u001B[?1003l" + // disable any-event mouse tracking
  "\u001B[?1005l" + // disable UTF-8 mouse mode
  "\u001B[?1006l" + // disable SGR mouse mode
  "\u001B[?1015l" + // disable urxvt mouse mode
  "\u001B[?1007l" + // disable alternate scroll mode
  "\u001B[?1004l" + // disable focus reporting
  "\u001B[?2004l" + // disable bracketed paste
  "\u001B[>4;0m" + // disable xterm modifyOtherKeys
  "\u001B[>4m" + // reset xterm modifyOtherKeys
  "\u001B[<u" // disable kitty keyboard protocol

const controllingTtyPath = "/dev/tty"
const shellPath = "/bin/sh"
const sttyPath = "/usr/bin/stty"
const snapshotPattern = /^[0-9a-fA-F:]+$/u

type TerminalCursorRuntime = CommandExecutor.CommandExecutor | FileSystem.FileSystem

const optionOrElse = <A>(option: Option.Option<A>, fallback: A): A => pipe(option, Option.getOrElse(() => fallback))

const succeeds = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<boolean, never, R> =>
  pipe(
    effect,
    Effect.as(true),
    Effect.option,
    Effect.map((result) => optionOrElse(result, false))
  )

const hasInteractiveTty = (): boolean => process.stdin.isTTY && process.stdout.isTTY

const disableRawMode = (): Effect.Effect<void> => {
  if (typeof process.stdin.setRawMode !== "function") {
    return Effect.void
  }

  return pipe(
    Effect.try(() => {
      process.stdin.setRawMode(false)
    }),
    Effect.ignore
  )
}

const ttyShellCommand = (script: string): Command.Command =>
  pipe(
    Command.make(shellPath, "-c", script),
    Command.stdin("inherit"),
    Command.stdout("pipe"),
    Command.stderr("pipe")
  )

const runTtyShell = (script: string): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  pipe(
    ttyShellCommand(script),
    Command.exitCode,
    Effect.map((exitCode) => Number(exitCode) === 0),
    Effect.option,
    Effect.map((result) => optionOrElse(result, false))
  )

const runTtyShellString = (script: string): Effect.Effect<string, never, CommandExecutor.CommandExecutor> =>
  pipe(
    ttyShellCommand(script),
    Command.string,
    Effect.map((output) => output.trim()),
    Effect.option,
    Effect.map((result) => optionOrElse(result, ""))
  )

const snapshotTerminalState = (): Effect.Effect<string | null, never, CommandExecutor.CommandExecutor> => {
  if (!hasInteractiveTty()) {
    return Effect.succeed(null)
  }

  return Effect.gen(function*(_) {
    yield* _(disableRawMode())
    const snapshot = yield* _(
      runTtyShellString(
        `if [ -c ${controllingTtyPath} ]; then ${sttyPath} -g < ${controllingTtyPath} 2>/dev/null || true; fi`
      )
    )
    return snapshotPattern.test(snapshot) ? snapshot : null
  })
}

const writeTerminalReset = (): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const wroteTty = yield* _(succeeds(fs.writeFileString(controllingTtyPath, terminalSaneEscape)))
    if (wroteTty) {
      return true
    }

    return yield* _(
      succeeds(
        Effect.try(() => {
          process.stdout.write(terminalSaneEscape)
        })
      )
    )
  })

const runSttySane = (): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  runTtyShell(
    `if [ -c ${controllingTtyPath} ]; then ${sttyPath} sane < ${controllingTtyPath} > ${controllingTtyPath} 2>/dev/null; else exit 1; fi`
  )

const restoreSttySnapshot = (snapshot: string): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  snapshotPattern.test(snapshot)
    ? runTtyShell(
      `if [ -c ${controllingTtyPath} ]; then ${sttyPath} '${snapshot}' < ${controllingTtyPath} > ${controllingTtyPath} 2>/dev/null; else exit 1; fi`
    )
    : Effect.succeed(false)

const repairInteractiveTerminal = (): Effect.Effect<void, never, TerminalCursorRuntime> => {
  if (!hasInteractiveTty()) {
    return Effect.void
  }

  return Effect.gen(function*(_) {
    yield* _(disableRawMode())
    const sane = yield* _(runSttySane())
    const wroteReset = sane ? yield* _(writeTerminalReset()) : false
    if (!wroteReset) {
      yield* _(writeTerminalReset())
    }
  })
}

const restoreTerminalState = (
  snapshot: string | null
): Effect.Effect<void, never, TerminalCursorRuntime> => {
  if (!hasInteractiveTty()) {
    return Effect.void
  }

  return Effect.gen(function*(_) {
    yield* _(disableRawMode())
    const restored = snapshot === null ? false : yield* _(restoreSttySnapshot(snapshot))
    if (!restored) {
      yield* _(runSttySane())
    }
    yield* _(writeTerminalReset())
  })
}

// CHANGE: ensure the terminal cursor is visible before handing control to interactive SSH
// WHY: Ink/TTY transitions can leave cursor hidden, which makes SSH shells look frozen
// QUOTE(ТЗ): "не виден курсор в SSH терминале"
// REF: issue-3
// SOURCE: n/a
// FORMAT THEOREM: forall t: interactive(t) -> cursor_visible(t)
// PURITY: SHELL
// EFFECT: Effect<void, never, TerminalCursorRuntime>
// INVARIANT: escape sequence is emitted only in interactive tty mode
// COMPLEXITY: O(1)
export const ensureTerminalCursorVisible = (): Effect.Effect<void, never, TerminalCursorRuntime> =>
  repairInteractiveTerminal()

export const withPreservedTerminalState = <A, E, R>(
  use: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | TerminalCursorRuntime> =>
  Effect.gen(function*(_) {
    const snapshot = yield* _(snapshotTerminalState())
    yield* _(ensureTerminalCursorVisible())
    return yield* _(use.pipe(Effect.ensuring(restoreTerminalState(snapshot))))
  })
