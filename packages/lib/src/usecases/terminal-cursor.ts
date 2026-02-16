import { Effect } from "effect"

const cursorVisibleEscape = "\u001B[?25h"

const hasInteractiveTty = (): boolean => process.stdin.isTTY && process.stdout.isTTY

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
    if (!hasInteractiveTty()) {
      return
    }
    process.stdout.write(cursorVisibleEscape)
  })
