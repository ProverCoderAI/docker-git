/* jscpd:ignore-start */
import { Effect } from "effect"
import * as childProcess from "node:child_process"
import * as fs from "node:fs"

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

const hasInteractiveTty = (): boolean => process.stdin.isTTY && process.stdout.isTTY

const disableRawMode = (): void => {
  if (typeof process.stdin.setRawMode !== "function") {
    return
  }
  try {
    process.stdin.setRawMode(false)
  } catch {
    // Ignore raw-mode reset failures when stdin is no longer attached to a tty.
  }
}

const withControllingTty = <A>(use: (fd: number) => A): A | null => {
  try {
    const fd = fs.openSync(controllingTtyPath, "r+")
    try {
      return use(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

const runSttyOnFd = (
  fd: number,
  args: ReadonlyArray<string>,
  captureOutput: boolean = false
): {
  readonly ok: boolean
  readonly stdout: string
} => {
  const result = childProcess.spawnSync("stty", args, {
    encoding: "utf8",
    stdio: [fd, captureOutput ? "pipe" : "ignore", "ignore"]
  })

  return {
    ok: result.error === undefined && result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : ""
  }
}

const writeTerminalReset = (fd?: number): boolean => {
  if (typeof fd === "number") {
    try {
      fs.writeSync(fd, terminalSaneEscape)
      return true
    } catch {
      return false
    }
  }

  try {
    process.stdout.write(terminalSaneEscape)
    return true
  } catch {
    return false
  }
}

type TerminalResetFallbackWrite = (chunk: string) => void

const snapshotTerminalStateSync = (): string | null => {
  if (!hasInteractiveTty()) {
    return null
  }

  disableRawMode()
  return withControllingTty((fd) => {
    const result = runSttyOnFd(fd, ["-g"], true)
    return result.ok && result.stdout.length > 0 ? result.stdout : null
  })
}

const repairInteractiveTerminalSync = (fallbackWrite?: TerminalResetFallbackWrite): void => {
  if (!hasInteractiveTty()) {
    return
  }

  disableRawMode()
  const repaired = withControllingTty((fd) => {
    const sane = runSttyOnFd(fd, ["sane"])
    return sane.ok && writeTerminalReset(fd)
  })

  if (!repaired) {
    if (typeof fallbackWrite === "function") {
      fallbackWrite(terminalSaneEscape)
      return
    }
    writeTerminalReset()
  }
}

const restoreTerminalStateSync = (snapshot: string | null): void => {
  if (!hasInteractiveTty()) {
    return
  }

  disableRawMode()
  const restored = withControllingTty((fd) => {
    if (snapshot !== null && runSttyOnFd(fd, [snapshot]).ok) {
      return writeTerminalReset(fd)
    }
    const sane = runSttyOnFd(fd, ["sane"])
    return sane.ok && writeTerminalReset(fd)
  })

  if (!restored) {
    writeTerminalReset()
  }
}

// CHANGE: ensure the terminal cursor is visible before handing control to interactive SSH
// WHY: Ink/TTY transitions can leave cursor hidden, which makes SSH shells look frozen
// QUOTE(ТЗ): "не виден курсор в SSH терминале"
// REF: issue-3
// SOURCE: n/a
// FORMAT THEOREM: forall t: interactive(t) -> cursor_visible(t)
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: escape sequence is emitted only in interactive tty mode
// COMPLEXITY: O(1)
export const ensureTerminalCursorVisible = (): Effect.Effect<void> =>
  Effect.sync(() => {
    repairInteractiveTerminalSync()
  })

// CHANGE: share the low-level tty repair across SSH launch and TUI suspend/resume
// WHY: both paths must reset the same controlling terminal before interactive output
// QUOTE(ТЗ): "при подключении по SSH контейнер забаганный. Кривокосо печатается текст"
// REF: user-request-2026-04-20-menu-select-ssh-terminal
// SOURCE: n/a
// FORMAT THEOREM: forall t: interactive(t) -> sane_tty(t)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: fallback writer is used only when /dev/tty repair is unavailable
// COMPLEXITY: O(1)
export const repairInteractiveTerminal = (fallbackWrite?: TerminalResetFallbackWrite): void => {
  repairInteractiveTerminalSync(fallbackWrite)
}

export const withPreservedTerminalState = <A, E, R>(
  use: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function*(_) {
    const snapshot = yield* _(Effect.sync(() => snapshotTerminalStateSync()))
    yield* _(ensureTerminalCursorVisible())
    return yield* _(use.pipe(Effect.ensuring(Effect.sync(() => {
      restoreTerminalStateSync(snapshot)
    }))))
  })
/* jscpd:ignore-end */
