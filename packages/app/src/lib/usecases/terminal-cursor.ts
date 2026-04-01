import { Effect } from "effect"

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
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false)
    }
    process.stdout.write(terminalSaneEscape)
  })
