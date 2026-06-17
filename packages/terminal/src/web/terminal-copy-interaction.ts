import {
  clearNativeBrowserCopyMenu,
  prepareNativeBrowserCopyMenu,
  type TerminalCopyTextarea,
  type TerminalNativeCopyMenuHost
} from "./terminal-copy-native-menu.js"
import {
  hasActiveMouseTracking,
  isKeyboardCopyShortcut,
  shouldForceBrowserTerminalSelection,
  shouldLetBrowserHandleTerminalCopyShortcut,
  type TerminalCopyKeyboardEvent,
  type TerminalMouseTrackingMode,
  writeTerminalSelectionToClipboardData
} from "./terminal-copy-rules.js"
import {
  createTerminalSelectionDragController,
  forceTerminalSelectionModifier,
  suppressTerminalMouseReport,
  type TerminalCopyMouseEvent,
  type TerminalCopyMouseEventType,
  type TerminalMouseButtonEvent,
  type TerminalSelectionDragTarget
} from "./terminal-copy-selection-drag.js"
import {
  type TerminalCopyClipboardData,
  TerminalSelectionContextSnapshot,
  type TerminalSelectionRestoreTarget,
  type TerminalSelectionTarget
} from "./terminal-copy-selection-snapshot.js"

export {
  shouldForceBrowserTerminalSelection,
  shouldForceTerminalSelectionContext,
  shouldLetBrowserHandleTerminalCopyShortcut,
  writeTerminalSelectionToClipboardData
} from "./terminal-copy-rules.js"
export type { TerminalCopyKeyboardEvent, TerminalMouseTrackingMode } from "./terminal-copy-rules.js"
export { forceTerminalSelectionModifier } from "./terminal-copy-selection-drag.js"

type TerminalDisposable = {
  readonly dispose: () => void
}

export type TerminalCopyInteractionTerminal = TerminalSelectionTarget & {
  readonly attachCustomKeyEventHandler?: (
    handler: (event: TerminalCopyKeyboardEvent) => boolean
  ) => void
  readonly modes: {
    readonly mouseTrackingMode: TerminalMouseTrackingMode
  }
  readonly onSelectionChange?: (handler: () => void) => TerminalDisposable
  readonly textarea?: TerminalCopyTextarea | undefined
} & TerminalSelectionRestoreTarget

type TerminalCopyClipboardEvent = {
  readonly clipboardData: TerminalCopyClipboardData | null
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

type TerminalCopyListenerRegistration = {
  (type: "copy", listener: (event: TerminalCopyClipboardEvent) => void, options: true): void
  (type: TerminalCopyMouseEventType, listener: (event: TerminalCopyMouseEvent) => void, options: true): void
}

type TerminalCopyInteractionHost = TerminalNativeCopyMenuHost & {
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

const isPrimaryMouseButton = (event: TerminalMouseButtonEvent): boolean => event.button === primaryMouseButton

const isSecondaryMouseButton = (event: TerminalMouseButtonEvent): boolean => event.button === secondaryMouseButton

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
    this.args.host.addEventListener("mousedown", this.onMouseDown, { capture: true })
    this.args.host.addEventListener("mouseup", this.onMouseUp, { capture: true })
    this.args.host.addEventListener("contextmenu", this.onContextMenu, { capture: true })
    this.args.host.addEventListener("copy", this.onCopy, { capture: true })
    return { dispose: this.dispose }
  }

  private readonly shouldLetBrowserHandleCopyShortcut = (event: TerminalCopyKeyboardEvent): boolean =>
    shouldLetBrowserHandleTerminalCopyShortcut(event, this.args.terminal) ||
    (isKeyboardCopyShortcut(event) && this.selectionContext.has())

  private readonly onTerminalKeyEvent = (event: TerminalCopyKeyboardEvent): boolean => {
    const shouldLetBrowserHandleCopy = this.shouldLetBrowserHandleCopyShortcut(event)
    if (!shouldLetBrowserHandleCopy && event.type === "keydown") {
      this.selectionContext.clear()
    }
    return !shouldLetBrowserHandleCopy
  }

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
    if (!this.args.terminal.hasSelection()) {
      this.selectionContext.restore()
      return
    }
    this.selectionContext.refresh()
  }

  private readonly hasProtectedSelectionContext = (): boolean =>
    hasActiveMouseTracking(this.args.terminal) &&
    (this.selectionContext.has() || this.args.terminal.hasSelection())

  private readonly prepareNativeBrowserCopyMenu = (event: TerminalCopyMouseEvent): boolean =>
    prepareNativeBrowserCopyMenu({
      event,
      host: this.args.host,
      selection: this.selectionContext.read(),
      textarea: this.args.terminal.textarea
    })

  private readonly clearNativeBrowserCopyMenu = (): void => {
    clearNativeBrowserCopyMenu(this.args.terminal.textarea)
  }

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
      this.clearNativeBrowserCopyMenu()
    }
    const isForceBrowserSelection = shouldForceBrowserTerminalSelection(event, this.args.terminal)
    const isForceSelectionContext = this.shouldProtectSelectionContext(event)
    if (!isForceBrowserSelection && !isForceSelectionContext) {
      if (isSecondaryMouseButton(event)) {
        this.selectionContext.clear()
        this.clearNativeBrowserCopyMenu()
      }
      return
    }
    forceTerminalSelectionModifier(event)
    if (isForceSelectionContext) {
      if (this.args.terminal.hasSelection()) {
        this.selectionContext.refresh()
      }
      this.prepareNativeBrowserCopyMenu(event)
      suppressTerminalMouseReport(event)
      return
    }
    if (isForceBrowserSelection) {
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
    this.prepareNativeBrowserCopyMenu(event)
    suppressTerminalMouseReport(event)
  }

  private readonly onCopy = (event: TerminalCopyClipboardEvent): void => {
    const isWroteSelection = writeTerminalSelectionToClipboardData(this.args.terminal, event.clipboardData)
    const isWroteSnapshot = isWroteSelection ? false : this.selectionContext.writeToClipboardData(event.clipboardData)
    if (!isWroteSelection && !isWroteSnapshot) {
      return
    }
    this.selectionContext.clear()
    this.clearNativeBrowserCopyMenu()
    event.preventDefault()
    event.stopPropagation()
  }

  private readonly dispose = (): void => {
    this.selectionChangeDisposable?.dispose()
    this.selectionChangeDisposable = null
    this.selectionDrag.dispose()
    this.selectionContext.clear()
    this.clearNativeBrowserCopyMenu()
    this.args.host.removeEventListener("mousedown", this.onMouseDown, true)
    this.args.host.removeEventListener("mouseup", this.onMouseUp, true)
    this.args.host.removeEventListener("contextmenu", this.onContextMenu, true)
    this.args.host.removeEventListener("copy", this.onCopy, true)
  }
}

export const attachTerminalCopyInteraction = (
  args: TerminalCopyInteractionArgs
): { readonly dispose: () => void } => new TerminalCopyInteractionController(args).attach()
