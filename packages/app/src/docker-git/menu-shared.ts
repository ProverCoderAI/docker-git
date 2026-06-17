import type { MenuViewContext, ViewState } from "./menu-types.js"

import { Effect, pipe } from "effect"
import { repairInteractiveTerminal, type TerminalCursorRuntime } from "./frontend-lib/shell/terminal-cursor.js"

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

let isStdoutPatched = false
let isStdoutMuted = false
let baseStdoutWrite: OutputWrite | null = null
let baseStderrWrite: OutputWrite | null = null
const primaryScreenEscape = "\u{1B}[?1049l\r\u{1B}[2K"

const wrapWrite = (baseWrite: OutputWrite): OutputWrite =>
(
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((err?: Error | null) => void),
  cb?: (err?: Error | null) => void
) => {
  if (isStdoutMuted) {
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

const writeTerminalControl = (text: string): void => {
  ensureStdoutPatched()
  const write = baseStdoutWrite ?? process.stdout.write.bind(process.stdout)
  write(text)
}

const disableTerminalInputModes = (): void => {
  // Disable mouse/input modes that can leak across TUI <-> SSH transitions.
  writeTerminalControl(
    "\u{1B}[0m" +
      "\u{1B}[?25h" +
      "\u{1B}[?1l" +
      "\u{1B}>" +
      "\u{1B}[?1000l\u{1B}[?1002l\u{1B}[?1003l\u{1B}[?1005l\u{1B}[?1006l\u{1B}[?1015l\u{1B}[?1007l" +
      "\u{1B}[?1004l\u{1B}[?2004l" +
      "\u{1B}[>4;0m\u{1B}[>4m\u{1B}[<u"
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
  if (isStdoutPatched) {
    return
  }
  baseStdoutWrite = process.stdout.write.bind(process.stdout)
  baseStderrWrite = process.stderr.write.bind(process.stderr)

  process.stdout.write = wrapWrite(baseStdoutWrite)
  process.stderr.write = wrapWrite(baseStderrWrite)
  isStdoutPatched = true
}

// CHANGE: allow writing to the terminal even while stdout is muted
// WHY: we mute Ink renders during interactive commands, but still need to show prompts/errors
// REF: user-request-2026-02-18-tui-output-hidden
// SOURCE: n/a
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: bypasses the mute wrapper safely
export const writeToTerminal = (text: string): void => {
  writeTerminalControl(text)
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
): Effect.Effect<void> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Effect.void
  }

  return Effect.async((resume) => {
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

export const writeErrorAndPause = (renderedError: string): Effect.Effect<void> =>
  pipe(
    Effect.sync(() => {
      writeToTerminal(`\n[docker-git] ${renderedError}\n`)
    }),
    Effect.zipRight(pauseForEnter()),
    Effect.asVoid
  )

export const withSuspendedTui = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: {
    readonly onError?: (error: E) => Effect.Effect<void>
    readonly onResume?: () => void
  }
): Effect.Effect<A, E, R | TerminalCursorRuntime> => {
  const withError = options?.onError
    ? pipe(effect, Effect.tapError((error) => Effect.ignore(options.onError?.(error) ?? Effect.void)))
    : effect

  return pipe(
    suspendTui(),
    Effect.zipRight(withError),
    Effect.ensuring(
      pipe(
        resumeTui(),
        Effect.zipRight(
          Effect.sync(() => {
            options?.onResume?.()
          })
        )
      )
    )
  )
}

export type SkipInputsContext = {
  readonly setSkipInputs: (update: (value: number) => number) => void
}

export type SshActiveContext = {
  readonly setSshActive: (active: boolean) => void
}

export const resumeWithSkipInputs = (context: SkipInputsContext, extra?: () => void) => () => {
  extra?.()
  context.setSkipInputs(() => 2)
}

export const resumeSshWithSkipInputs = (context: SkipInputsContext & SshActiveContext) =>
  resumeWithSkipInputs(context, () => {
    context.setSshActive(false)
  })

export const pauseOnError = <E>(render: (error: E) => string) => (error: E): Effect.Effect<void> =>
  writeErrorAndPause(render(error))

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
  isStdoutMuted = muted
}

const setStdoutMutedEffect = (muted: boolean): Effect.Effect<void> =>
  Effect.sync(() => {
    setStdoutMuted(muted)
  })

const writeTerminalControlEffect = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    writeTerminalControl(text)
  })

const setRawModeEffect = (enabled: boolean): Effect.Effect<void> =>
  process.stdin.isTTY && typeof process.stdin.setRawMode === "function"
    ? pipe(
      Effect.try(() => {
        process.stdin.setRawMode(enabled)
      }),
      Effect.ignore
    )
    : Effect.void

const whenStdoutTty = (effect: Effect.Effect<void, never, TerminalCursorRuntime>) =>
  process.stdout.isTTY ? effect : Effect.void

const preparePrimaryScreen = (): Effect.Effect<void, never, TerminalCursorRuntime> =>
  Effect.gen(function*(_) {
    yield* _(setStdoutMutedEffect(true))
    yield* _(repairInteractiveTerminal(writeTerminalControl))
    yield* _(writeTerminalControlEffect(primaryScreenEscape))
  })

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
export const suspendTui = (): Effect.Effect<void, never, TerminalCursorRuntime> =>
  whenStdoutTty(
    preparePrimaryScreen().pipe(
      // Switch back to the primary screen so interactive commands (ssh/gh/codex)
      // can render normally. Do not clear it: users may need scrollback (OAuth codes/URLs).
      Effect.asVoid
    )
  )

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
export const resumeTui = (): Effect.Effect<void, never, TerminalCursorRuntime> =>
  whenStdoutTty(
    Effect.gen(function*(_) {
      yield* _(repairInteractiveTerminal(writeTerminalControl))
      // Return to the alternate screen for Ink rendering.
      yield* _(writeTerminalControlEffect("\u{1B}[?1049h\u{1B}[2J\u{1B}[H"))
      yield* _(setRawModeEffect(true))
      yield* _(Effect.sync(() => {
        disableTerminalInputModes()
      }))
      yield* _(setStdoutMutedEffect(false))
    })
  )

export const leaveTui = (): Effect.Effect<void, never, TerminalCursorRuntime> =>
  whenStdoutTty(
    Effect.gen(function*(_) {
      // Ensure we don't leave the terminal in a broken "mouse reporting" mode.
      yield* _(preparePrimaryScreen())
      // Restore the primary screen on exit without clearing it (keeps useful scrollback).
      yield* _(setRawModeEffect(false))
      yield* _(setStdoutMutedEffect(false))
    })
  )

export const resetToMenu = (context: MenuResetContext): void => {
  const view: ViewState = { _tag: "Menu" }
  context.setView(view)
  context.setMessage(null)
}
