import {
  createTerminalSelectionDragController,
  forceTerminalSelectionModifier,
  suppressTerminalMouseReport,
  type TerminalCopyMouseEvent,
  type TerminalCopyMouseEventType,
  type TerminalMouseButtonEvent,
  type TerminalSelectionDragTarget
} from "./terminal-copy-selection-drag.js"

export { forceTerminalSelectionModifier } from "./terminal-copy-selection-drag.js"

export type TerminalMouseTrackingMode = "any" | "drag" | "none" | "vt200" | "x10"

type TerminalSelectionTarget = {
  readonly getSelection: () => string
  readonly hasSelection: () => boolean
}

type TerminalDisposable = {
  readonly dispose: () => void
}

export type TerminalCopyKeyboardEvent = {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly type: string
}

export type TerminalCopyInteractionTerminal = TerminalSelectionTarget & {
  readonly attachCustomKeyEventHandler?: (
    handler: (event: TerminalCopyKeyboardEvent) => boolean
  ) => void
  readonly modes: {
    readonly mouseTrackingMode: TerminalMouseTrackingMode
  }
  readonly onSelectionChange?: (handler: () => void) => TerminalDisposable
}

type TerminalCopyClipboardData = {
  readonly setData: (format: string, data: string) => void
}

type TerminalCopyClipboardEvent = {
  readonly clipboardData: TerminalCopyClipboardData | null
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

type TerminalCopyListenerRegistration = {
  (type: "copy", listener: (event: TerminalCopyClipboardEvent) => void, options: true): void
  (type: TerminalCopyMouseEventType, listener: (event: TerminalCopyMouseEvent) => void, options: true): void
}

type TerminalCopyInteractionHost = {
  readonly ownerDocument?: TerminalSelectionDragTarget | null
  readonly addEventListener: TerminalCopyListenerRegistration
  readonly removeEventListener: TerminalCopyListenerRegistration
}

type TerminalCopyInteractionArgs = {
  readonly host: TerminalCopyInteractionHost
  readonly terminal: TerminalCopyInteractionTerminal
}

const primaryMouseButton = 0
const secondaryMouseButton = 2
const terminalSelectionContextSnapshotTtlMs = 10_000

const isPrimaryMouseButton = (event: TerminalMouseButtonEvent): boolean => event.button === primaryMouseButton

const isSecondaryMouseButton = (event: TerminalMouseButtonEvent): boolean => event.button === secondaryMouseButton

const hasActiveMouseTracking = (terminal: TerminalCopyInteractionTerminal): boolean =>
  terminal.modes.mouseTrackingMode !== "none"

const isKeyboardCopyShortcut = (event: TerminalCopyKeyboardEvent): boolean =>
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
  terminal: TerminalCopyInteractionTerminal
): boolean => isPrimaryMouseButton(event) && hasActiveMouseTracking(terminal)

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
  terminal: TerminalCopyInteractionTerminal
): boolean => isSecondaryMouseButton(event) && hasActiveMouseTracking(terminal) && terminal.hasSelection()

export const writeTerminalSelectionToClipboardData = (
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

class TerminalSelectionContextSnapshot {
  private selection = ""
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly terminal: TerminalSelectionTarget) {}

  readonly clear = (): void => {
    this.selection = ""
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  readonly has = (): boolean => this.selection.length > 0

  readonly refresh = (): boolean => {
    const selection = this.terminal.getSelection()
    if (selection.length === 0) {
      this.clear()
      return false
    }
    this.selection = selection
    if (this.timer !== null) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(this.clear, terminalSelectionContextSnapshotTtlMs)
    return true
  }

  readonly writeToClipboardData = (clipboardData: TerminalCopyClipboardData | null): boolean => {
    if (clipboardData === null || this.selection.length === 0) {
      return false
    }
    clipboardData.setData("text/plain", this.selection)
    return true
  }
}

class TerminalCopyInteractionController {
  private readonly selectionContext: TerminalSelectionContextSnapshot
  private readonly selectionDrag: ReturnType<typeof createTerminalSelectionDragController>
  private selectionChangeDisposable: TerminalDisposable | null = null

  constructor(private readonly args: TerminalCopyInteractionArgs) {
    this.selectionContext = new TerminalSelectionContextSnapshot(args.terminal)
    this.selectionDrag = createTerminalSelectionDragController(args.host)
  }

  readonly attach = (): { readonly dispose: () => void } => {
    this.args.terminal.attachCustomKeyEventHandler?.(this.onTerminalKeyEvent)
    this.selectionChangeDisposable = this.args.terminal.onSelectionChange?.(this.onTerminalSelectionChange) ?? null
    this.args.host.addEventListener("mousedown", this.onMouseDown, true)
    this.args.host.addEventListener("mouseup", this.onMouseUp, true)
    this.args.host.addEventListener("contextmenu", this.onContextMenu, true)
    this.args.host.addEventListener("copy", this.onCopy, true)
    return { dispose: this.dispose }
  }

  private readonly shouldLetBrowserHandleCopyShortcut = (event: TerminalCopyKeyboardEvent): boolean =>
    shouldLetBrowserHandleTerminalCopyShortcut(event, this.args.terminal) ||
    (isKeyboardCopyShortcut(event) && this.selectionContext.has())

  private readonly onTerminalKeyEvent = (event: TerminalCopyKeyboardEvent): boolean =>
    !this.shouldLetBrowserHandleCopyShortcut(event)

  private readonly onTerminalSelectionChange = (): void => {
    // CHANGE: keep a copyable snapshot before terminal redraws can drop xterm's live selection.
    // WHY: Claude Code periodically repaints the TUI; xterm selection is buffer-bound and may vanish during repaint.
    // QUOTE(ТЗ): "когда очистился выделение бы не спадало"
    // REF: user-message-2026-06-15-terminal-redraw-selection
    // SOURCE: n/a
    // FORMAT THEOREM: selected(t) before redraw(t) => cachedSelection(t)
    // PURITY: SHELL
    // EFFECT: reads terminal.hasSelection() and terminal.getSelection().
    // INVARIANT: empty redraw selection events do not erase the last user-created non-empty selection snapshot.
    // COMPLEXITY: O(n)/O(1) where n = selected text length.
    if (this.args.terminal.hasSelection()) {
      this.selectionContext.refresh()
    }
  }

  private readonly hasProtectedSelectionContext = (): boolean =>
    hasActiveMouseTracking(this.args.terminal) &&
    (this.selectionContext.has() || this.args.terminal.hasSelection())

  private readonly shouldProtectSelectionContext = (event: TerminalCopyMouseEvent): boolean =>
    isSecondaryMouseButton(event) && this.hasProtectedSelectionContext()

  private readonly onSelectionContextMouseEvent = (event: TerminalCopyMouseEvent): boolean => {
    if (!this.shouldProtectSelectionContext(event)) {
      return false
    }
    forceTerminalSelectionModifier(event)
    if (this.args.terminal.hasSelection()) {
      this.selectionContext.refresh()
    }
    return true
  }

  private readonly onMouseDown = (event: TerminalCopyMouseEvent): void => {
    if (isPrimaryMouseButton(event)) {
      this.selectionContext.clear()
    }
    const forceBrowserSelection = shouldForceBrowserTerminalSelection(event, this.args.terminal)
    const forceSelectionContext = shouldForceTerminalSelectionContext(event, this.args.terminal)
    if (!forceBrowserSelection && !forceSelectionContext) {
      if (isSecondaryMouseButton(event)) {
        this.selectionContext.clear()
      }
      return
    }
    forceTerminalSelectionModifier(event)
    if (forceSelectionContext) {
      this.selectionContext.refresh()
      suppressTerminalMouseReport(event)
      return
    }
    if (forceBrowserSelection) {
      this.selectionDrag.start()
    }
  }

  private readonly onMouseUp = (event: TerminalCopyMouseEvent): void => {
    if (!this.onSelectionContextMouseEvent(event)) {
      return
    }
    suppressTerminalMouseReport(event)
  }

  private readonly onContextMenu = (event: TerminalCopyMouseEvent): void => {
    // CHANGE: stop protected context menus before xterm can rewrite terminal selection.
    // WHY: xterm's rightClickHandler prepares a textarea for copy and can clear TUI selections while mouse tracking is active.
    // QUOTE(ТЗ): "Когда я выделяю что-то и нажимаю правую кнопку ... выделение слетает"
    // REF: user-message-2026-06-15-claude-code-selection
    // SOURCE: n/a
    // FORMAT THEOREM: protected(e,t) => stopped(e) and not defaultPrevented(e)
    // PURITY: SHELL
    // INVARIANT: empty selection context menus still pass through.
    // COMPLEXITY: O(1)/O(1)
    if (!this.hasProtectedSelectionContext()) {
      return
    }
    forceTerminalSelectionModifier(event)
    if (this.args.terminal.hasSelection()) {
      this.selectionContext.refresh()
    }
    suppressTerminalMouseReport(event)
  }

  private readonly onCopy = (event: TerminalCopyClipboardEvent): void => {
    const wroteSelection = writeTerminalSelectionToClipboardData(this.args.terminal, event.clipboardData)
    const wroteSnapshot = wroteSelection ? false : this.selectionContext.writeToClipboardData(event.clipboardData)
    if (!wroteSelection && !wroteSnapshot) {
      return
    }
    this.selectionContext.clear()
    event.preventDefault()
    event.stopPropagation()
  }

  private readonly dispose = (): void => {
    this.selectionChangeDisposable?.dispose()
    this.selectionChangeDisposable = null
    this.selectionDrag.dispose()
    this.selectionContext.clear()
    this.args.host.removeEventListener("mousedown", this.onMouseDown, true)
    this.args.host.removeEventListener("mouseup", this.onMouseUp, true)
    this.args.host.removeEventListener("contextmenu", this.onContextMenu, true)
    this.args.host.removeEventListener("copy", this.onCopy, true)
  }
}

export const attachTerminalCopyInteraction = (
  args: TerminalCopyInteractionArgs
): { readonly dispose: () => void } => new TerminalCopyInteractionController(args).attach()
