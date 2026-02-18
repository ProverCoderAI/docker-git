import type { MenuViewContext, ViewState } from "./menu-types.js"

import { Effect } from "effect"

// CHANGE: share menu escape handling across flows
// WHY: avoid duplicated logic in TUI handlers
// QUOTE(ТЗ): "А ты можешь сделать удобный выбор проектов?"
// REF: user-request-2026-02-02-select-project
// SOURCE: n/a
// FORMAT THEOREM: forall s: escape(s) -> menu(s)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: always resets message on escape
// COMPLEXITY: O(1)

type MenuResetContext = Pick<MenuViewContext, "setView" | "setMessage">

type OutputWrite = typeof process.stdout.write

let stdoutPatched = false
let stdoutMuted = false
let baseStdoutWrite: OutputWrite | null = null
let baseStderrWrite: OutputWrite | null = null

const disableMouseModes = (): void => {
  // Disable xterm/urxvt mouse tracking and "alternate scroll" mode (wheel -> arrow keys).
  process.stdout.write(
    "\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1005l\u001B[?1006l\u001B[?1015l\u001B[?1007l"
  )
}

// CHANGE: mute Ink stdout writes while SSH is active
// WHY: prevent Ink resize re-renders from corrupting the SSH terminal buffer
// QUOTE(ТЗ): "при изменении разершения он всё ломает?"
// REF: user-request-2026-02-05-ssh-resize
// SOURCE: n/a
// FORMAT THEOREM: ∀w: muted(w) → ¬writes(ink, stdout)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: wrapper preserves original stdout write when not muted
// COMPLEXITY: O(1)
const ensureStdoutPatched = (): void => {
  if (stdoutPatched) {
    return
  }
  baseStdoutWrite = process.stdout.write.bind(process.stdout)
  baseStderrWrite = process.stderr.write.bind(process.stderr)
  const wrapWrite =
    (baseWrite: OutputWrite): OutputWrite =>
      (
        chunk: string | Uint8Array,
        encoding?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void
      ) => {
        if (stdoutMuted) {
          const callback = typeof encoding === "function" ? encoding : cb
          if (typeof callback === "function") {
            callback()
          }
          return true
        }
        if (typeof encoding === "function") {
          return baseWrite(chunk, encoding)
        }
        return baseWrite(chunk, encoding, cb)
      }

  process.stdout.write = wrapWrite(baseStdoutWrite)
  process.stderr.write = wrapWrite(baseStderrWrite)
  stdoutPatched = true
}

// CHANGE: allow writing to the terminal even while stdout is muted
// WHY: we mute Ink renders during interactive commands, but still need to show prompts/errors
// REF: user-request-2026-02-18-tui-output-hidden
// SOURCE: n/a
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: bypasses the mute wrapper safely
export const writeToTerminal = (text: string): void => {
  ensureStdoutPatched()
  const write = baseStdoutWrite ?? process.stdout.write.bind(process.stdout)
  write(text)
}

// CHANGE: keep the user on the primary screen until they acknowledge
// WHY: otherwise output from failed docker/gh commands gets hidden again when TUI resumes
// REF: user-request-2026-02-18-tui-output-hidden
// SOURCE: n/a
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: no-op when stdin/stdout aren't TTY (CI/e2e)
export const pauseForEnter = (
  prompt = "Press Enter to return to docker-git..."
): Effect.Effect<void, never, never> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Effect.void
  }

  return Effect.async<void>((resume) => {
    // Ensure the prompt isn't glued to the last command line.
    writeToTerminal(`\n${prompt}\n`)
    process.stdin.resume()

    const cleanup = () => {
      process.stdin.off("data", onData)
    }

    const onData = () => {
      cleanup()
      resume(Effect.void)
    }

    process.stdin.on("data", onData)

    return Effect.sync(() => {
      cleanup()
    })
  }).pipe(Effect.asVoid)
}

// CHANGE: toggle stdout write muting for Ink rendering
// WHY: allow SSH sessions to own the terminal without TUI redraws
// QUOTE(ТЗ): "при изменении разершения он всё ломает?"
// REF: user-request-2026-02-05-ssh-resize
// SOURCE: n/a
// FORMAT THEOREM: ∀m ∈ {true,false}: muted = m
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: stdout wrapper is installed at most once
// COMPLEXITY: O(1)
const setStdoutMuted = (muted: boolean): void => {
  ensureStdoutPatched()
  stdoutMuted = muted
}

// CHANGE: temporarily suspend TUI rendering when running interactive commands
// WHY: avoid mixed output from docker/ssh and the Ink UI
// QUOTE(ТЗ): "Почему так кривокосо всё отображается?"
// REF: user-request-2026-02-02-tui-output
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: suspend -> cleanOutput(cmd)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: only toggles when TTY is available
// COMPLEXITY: O(1)
export const suspendTui = (): void => {
  if (!process.stdout.isTTY) {
    return
  }
  disableMouseModes()
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false)
  }
  // Switch back to the primary screen so interactive commands (ssh/gh/codex)
  // can render normally. Do not clear it: users may need scrollback (OAuth codes/URLs).
  process.stdout.write("\u001B[?1049l")
  setStdoutMuted(true)
}

// CHANGE: restore TUI rendering after interactive commands
// WHY: return to Ink UI without broken terminal state
// QUOTE(ТЗ): "Почему так кривокосо всё отображается?"
// REF: user-request-2026-02-02-tui-output
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: resume -> tuiVisible(cmd)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: only toggles when TTY is available
// COMPLEXITY: O(1)
export const resumeTui = (): void => {
  if (!process.stdout.isTTY) {
    return
  }
  setStdoutMuted(false)
  disableMouseModes()
  // Return to the alternate screen for Ink rendering.
  process.stdout.write("\u001B[?1049h\u001B[2J\u001B[H")
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(true)
  }
  disableMouseModes()
}

export const leaveTui = (): void => {
  if (!process.stdout.isTTY) {
    return
  }
  // Ensure we don't leave the terminal in a broken "mouse reporting" mode.
  setStdoutMuted(false)
  disableMouseModes()
  // Restore the primary screen on exit without clearing it (keeps useful scrollback).
  process.stdout.write("\u001B[?1049l")
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false)
  }
}

export const resetToMenu = (context: MenuResetContext): void => {
  const view: ViewState = { _tag: "Menu" }
  context.setView(view)
  context.setMessage(null)
}
