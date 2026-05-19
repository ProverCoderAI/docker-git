export type TerminalMouseTrackingMode = "any" | "drag" | "none" | "vt200" | "x10"

type TerminalSelectionTarget = {
  readonly getSelection: () => string
  readonly hasSelection: () => boolean
}

export type TerminalCopyInteractionTerminal = TerminalSelectionTarget & {
  readonly modes: {
    readonly mouseTrackingMode: TerminalMouseTrackingMode
  }
}

type TerminalMouseButtonEvent = {
  readonly button: number
}

type TerminalSelectionModifierEvent = {
  readonly altKey: boolean
  readonly shiftKey: boolean
}

type TerminalCopyClipboardData = {
  readonly setData: (format: string, data: string) => void
}

type TerminalCopyClipboardEvent = {
  readonly clipboardData: TerminalCopyClipboardData | null
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

type TerminalCopyMouseEvent = TerminalMouseButtonEvent & TerminalSelectionModifierEvent

type TerminalSelectionDragEventType = "mousemove" | "mouseup"

type TerminalSelectionDragListenerRegistration = (
  type: TerminalSelectionDragEventType,
  listener: (event: TerminalSelectionModifierEvent) => void,
  options: true
) => void

type TerminalSelectionDragTarget = {
  readonly addEventListener: TerminalSelectionDragListenerRegistration
  readonly removeEventListener: TerminalSelectionDragListenerRegistration
}

type TerminalCopyListenerRegistration = {
  (type: "copy", listener: (event: TerminalCopyClipboardEvent) => void, options: true): void
  (type: "mousedown", listener: (event: TerminalCopyMouseEvent) => void, options: true): void
  (
    type: TerminalSelectionDragEventType,
    listener: (event: TerminalSelectionModifierEvent) => void,
    options: true
  ): void
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

type TerminalSelectionDragController = {
  readonly dispose: () => void
  readonly start: () => void
}

const primaryMouseButton = 0
const secondaryMouseButton = 2

const macPlatformNames = new Set(["Mac68K", "MacIntel", "Macintosh", "MacPPC"])

const currentNavigatorPlatform = (): string => {
  if (typeof navigator === "undefined") {
    return ""
  }
  return navigator.platform
}

const isPrimaryMouseButton = (event: TerminalMouseButtonEvent): boolean => event.button === primaryMouseButton

const isSecondaryMouseButton = (event: TerminalMouseButtonEvent): boolean => event.button === secondaryMouseButton

const hasActiveMouseTracking = (terminal: TerminalCopyInteractionTerminal): boolean =>
  terminal.modes.mouseTrackingMode !== "none"

export const shouldForceBrowserTerminalSelection = (
  event: TerminalMouseButtonEvent,
  terminal: TerminalCopyInteractionTerminal
): boolean => isPrimaryMouseButton(event) && hasActiveMouseTracking(terminal)

export const shouldForceTerminalSelectionContext = (
  event: TerminalMouseButtonEvent,
  terminal: TerminalCopyInteractionTerminal
): boolean => isSecondaryMouseButton(event) && terminal.hasSelection()

const terminalSelectionModifier = (platform: string): keyof TerminalSelectionModifierEvent =>
  macPlatformNames.has(platform) ? "altKey" : "shiftKey"

export const forceTerminalSelectionModifier = (
  event: TerminalSelectionModifierEvent,
  platform: string = currentNavigatorPlatform()
): boolean =>
  Reflect.defineProperty(event, terminalSelectionModifier(platform), {
    configurable: true,
    value: true
  })

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

const resolveTerminalSelectionDragTarget = (
  host: TerminalCopyInteractionHost
): TerminalSelectionDragTarget => host.ownerDocument ?? host

const createTerminalSelectionDragController = (
  host: TerminalCopyInteractionHost
): TerminalSelectionDragController => {
  let forcedSelectionDrag = false
  let selectionDragTarget: TerminalSelectionDragTarget | null = null

  const clearSelectionDrag = (): void => {
    if (selectionDragTarget === null) {
      forcedSelectionDrag = false
      return
    }
    selectionDragTarget.removeEventListener("mousemove", onMouseMove, true)
    selectionDragTarget.removeEventListener("mouseup", onMouseUp, true)
    selectionDragTarget = null
    forcedSelectionDrag = false
  }

  const onMouseMove = (event: TerminalSelectionModifierEvent): void => {
    if (!forcedSelectionDrag) {
      return
    }
    forceTerminalSelectionModifier(event)
  }

  const onMouseUp = (event: TerminalSelectionModifierEvent): void => {
    if (forcedSelectionDrag) {
      forceTerminalSelectionModifier(event)
    }
    clearSelectionDrag()
  }

  const startSelectionDrag = (): void => {
    clearSelectionDrag()
    forcedSelectionDrag = true
    selectionDragTarget = resolveTerminalSelectionDragTarget(host)
    selectionDragTarget.addEventListener("mousemove", onMouseMove, true)
    selectionDragTarget.addEventListener("mouseup", onMouseUp, true)
  }

  return {
    dispose: clearSelectionDrag,
    start: startSelectionDrag
  }
}

export const attachTerminalCopyInteraction = (
  args: TerminalCopyInteractionArgs
): { readonly dispose: () => void } => {
  const selectionDrag = createTerminalSelectionDragController(args.host)

  const onMouseDown = (event: TerminalCopyMouseEvent): void => {
    const forceBrowserSelection = shouldForceBrowserTerminalSelection(event, args.terminal)
    const forceSelectionContext = shouldForceTerminalSelectionContext(event, args.terminal)
    if (!forceBrowserSelection && !forceSelectionContext) {
      return
    }
    forceTerminalSelectionModifier(event)
    if (forceBrowserSelection) {
      selectionDrag.start()
    }
  }
  const onCopy = (event: TerminalCopyClipboardEvent): void => {
    if (!writeTerminalSelectionToClipboardData(args.terminal, event.clipboardData)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  args.host.addEventListener("mousedown", onMouseDown, true)
  args.host.addEventListener("copy", onCopy, true)

  return {
    dispose: () => {
      selectionDrag.dispose()
      args.host.removeEventListener("mousedown", onMouseDown, true)
      args.host.removeEventListener("copy", onCopy, true)
    }
  }
}
