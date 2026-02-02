import type { MenuViewContext, ViewState } from "./menu-types.js"

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
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false)
  }
  process.stdout.write("\u001B[?1049l\u001B[2J\u001B[H")
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
  process.stdout.write("\u001B[?1049h\u001B[2J\u001B[H")
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(true)
  }
}

export const resetToMenu = (context: MenuResetContext): void => {
  const view: ViewState = { _tag: "Menu" }
  context.setView(view)
  context.setMessage(null)
}
