import type { TerminalCopyClipboardData, TerminalSelectionTarget } from "./terminal-copy-selection-snapshot.js"

export type TerminalMouseTrackingMode = "any" | "drag" | "none" | "vt200" | "x10"

export type TerminalCopyKeyboardEvent = {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly type: string
}

type TerminalMouseButtonEvent = {
  readonly button: number
}

type TerminalMouseTrackingTarget = {
  readonly modes: {
    readonly mouseTrackingMode: TerminalMouseTrackingMode
  }
}

const primaryMouseButton = 0
const secondaryMouseButton = 2

export const hasActiveMouseTracking = (terminal: TerminalMouseTrackingTarget): boolean =>
  terminal.modes.mouseTrackingMode !== "none"

export const isKeyboardCopyShortcut = (event: TerminalCopyKeyboardEvent): boolean =>
  event.type === "keydown" &&
  !event.altKey &&
  (event.ctrlKey || event.metaKey) &&
  event.key.toLowerCase() === "c"

/**
 * Decides whether xterm key processing must step aside for native browser copy.
 *
 * @param event - Keyboard event seen by xterm before it translates keys into pty input.
 * @param terminal - Terminal selection facade.
 * @returns True iff the event is a system copy shortcut and selected terminal text is non-empty.
 * @pure true
 * @effect terminal.hasSelection(), terminal.getSelection().
 * @invariant result => no ETX input is sent for selected terminal text copy.
 * @precondition `event` and `terminal` are non-null.
 * @postcondition True means xterm should return false from its custom key handler.
 * @complexity O(n) where n = selected text length.
 * @throws Never
 */
// CHANGE: keep keyboard copy shortcuts out of terminal input when text is selected
// WHY: Ctrl/Cmd+C must copy the selected terminal text instead of sending SIGINT to the pty
// QUOTE(ТЗ): "Text easy coping"
// REF: issue-353
// SOURCE: n/a
// FORMAT THEOREM: selected(t) and copyShortcut(e) => browserCopy(e,t)
// PURITY: CORE
// EFFECT: reads terminal selection through the injected terminal facade
// INVARIANT: empty selection never blocks terminal Ctrl+C semantics
// COMPLEXITY: O(n)/O(1)
export const shouldLetBrowserHandleTerminalCopyShortcut = (
  event: TerminalCopyKeyboardEvent,
  terminal: TerminalSelectionTarget
): boolean => isKeyboardCopyShortcut(event) && terminal.hasSelection() && terminal.getSelection().length > 0

export const shouldForceBrowserTerminalSelection = (
  event: TerminalMouseButtonEvent,
  terminal: TerminalMouseTrackingTarget
): boolean => event.button === primaryMouseButton && hasActiveMouseTracking(terminal)

/**
 * Decides whether a secondary-button event must preserve the terminal selection context.
 *
 * @param event - Mouse button event captured before xterm/tmux handlers can clear the selection.
 * @param terminal - Terminal selection and mouse-tracking facade.
 * @returns True iff the event is a secondary click, mouse tracking is active, and a selection exists.
 * @pure true
 * @effect isSecondaryMouseButton(event), hasActiveMouseTracking(terminal), terminal.hasSelection().
 * @invariant result <=> secondary(event) and tracking(terminal) and selected(terminal).
 * @precondition `event` and `terminal` are non-null; mouse tracking may be `none`, which disables forcing.
 * @postcondition True means the caller may snapshot selection text before suppressing terminal mouse reporting.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: document the guarded right-click selection preservation predicate
// WHY: selection protection is valid only while terminal mouse tracking can consume right-click events
// QUOTE(ТЗ): "right-click with selection should remain copyable in the terminal"
// REF: issue-340
// SOURCE: n/a
// FORMAT THEOREM: forall e,t: force(e,t) <-> secondary(e) and tracking(t) and hasSelection(t)
// PURITY: CORE
// EFFECT: reads terminal.hasSelection through the injected terminal facade
// INVARIANT: mouseTrackingMode = none always yields false
// COMPLEXITY: O(1)
export const shouldForceTerminalSelectionContext = (
  event: TerminalMouseButtonEvent,
  terminal: TerminalMouseTrackingTarget & TerminalSelectionTarget
): boolean => event.button === secondaryMouseButton && hasActiveMouseTracking(terminal) && terminal.hasSelection()

export const didWriteTerminalSelectionToClipboardData = (
  terminal: TerminalSelectionTarget,
  clipboardData: TerminalCopyClipboardData | null
): boolean => {
  if (clipboardData === null || !terminal.hasSelection()) {
    return false
  }
  const selection = terminal.getSelection()
  if (selection.length === 0) {
    return false
  }
  clipboardData.setData("text/plain", selection)
  return true
}
