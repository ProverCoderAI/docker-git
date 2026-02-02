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

export const resetToMenu = (context: MenuResetContext): void => {
  const view: ViewState = { _tag: "Menu" }
  context.setView(view)
  context.setMessage(null)
}
